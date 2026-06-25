import type { PrismaClient } from "@prisma/client";
import {
  keysBetween,
  type MetadataSchema,
  type MetadataFieldDef,
  type PresetDef,
  type FieldType,
  type FieldKind,
  type StandardFieldKey,
} from "@lumio/shared";
import { prisma } from "./client.js";

type GroupDb = Pick<PrismaClient, "metadataGroup">;
type FieldDb = Pick<PrismaClient, "metadataField">;
type ValueDb = Pick<PrismaClient, "photoMetadataValue">;
type TxDb = Pick<PrismaClient, "$transaction">;

/** Ordered groups (each with its ordered, included + disabled fields) for a catalog. */
export async function getCatalogSchema(
  catalogId: string,
  db: GroupDb & FieldDb = prisma,
): Promise<MetadataSchema> {
  const [groups, fields] = await Promise.all([
    db.metadataGroup.findMany({ where: { catalogId }, orderBy: { position: "asc" } }),
    db.metadataField.findMany({ where: { catalogId }, orderBy: { position: "asc" } }),
  ]);
  const byGroup = new Map<string, MetadataFieldDef[]>();
  for (const f of fields) {
    const def: MetadataFieldDef = {
      id: f.id,
      key: f.key,
      label: f.label,
      type: f.type as FieldType,
      kind: f.kind as FieldKind,
      builtinKey: (f.builtinKey as StandardFieldKey | null) ?? null,
      enabled: f.enabled,
      suggests: f.suggests,
    };
    const list = byGroup.get(f.groupId ?? "") ?? [];
    list.push(def);
    byGroup.set(f.groupId ?? "", list);
  }
  return groups.map((g) => ({ id: g.id, label: g.label, fields: byGroup.get(g.id) ?? [] }));
}

/** Instantiate a preset's groups + fields for a catalog. Wrapped in a transaction. */
export async function applyMetadataPreset(
  catalogId: string,
  preset: PresetDef,
  db: TxDb = prisma,
): Promise<void> {
  const groupPositions = keysBetween(null, null, preset.groups.length);
  await db.$transaction(async (tx) => {
    for (let gi = 0; gi < preset.groups.length; gi += 1) {
      const pg = preset.groups[gi]!;
      const group = await tx.metadataGroup.create({
        data: { catalogId, label: pg.label, position: groupPositions[gi]! },
      });
      const fieldPositions = keysBetween(null, null, pg.fields.length);
      for (let fi = 0; fi < pg.fields.length; fi += 1) {
        const pf = pg.fields[fi]!;
        await tx.metadataField.create({
          data: {
            catalogId,
            groupId: group.id,
            key: pf.key,
            label: pf.label,
            type: pf.type,
            kind: pf.kind,
            builtinKey: pf.builtinKey ?? null,
            position: fieldPositions[fi]!,
          },
        });
      }
    }
  });
}

/** Remove a catalog's entire custom-field schema (fields first, then groups). */
export async function clearCatalogSchema(catalogId: string, db: TxDb = prisma): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.metadataField.deleteMany({ where: { catalogId } });
    await tx.metadataGroup.deleteMany({ where: { catalogId } });
  });
}

/** Set (or clear, when empty) a photo's value for one field. NULL-safe upsert. */
export async function upsertPhotoMetadataValue(
  photoId: string,
  fieldId: string,
  value: string,
  db: ValueDb = prisma,
): Promise<void> {
  const trimmed = value.trim();
  if (trimmed === "") {
    await db.photoMetadataValue.deleteMany({ where: { photoId, fieldId } });
    return;
  }
  const updated = await db.photoMetadataValue.updateMany({
    where: { photoId, fieldId },
    data: { value: trimmed },
  });
  if (updated.count === 0) {
    await db.photoMetadataValue.create({ data: { photoId, fieldId, value: trimmed } });
  }
}

/** Map of fieldId → stored value for one photo. */
export async function getPhotoMetadataValues(
  photoId: string,
  db: ValueDb = prisma,
): Promise<Map<string, string>> {
  const rows = await db.photoMetadataValue.findMany({ where: { photoId } });
  return new Map(rows.map((r) => [r.fieldId, r.value]));
}

/** Distinct prior values for a field (most-used first), optionally prefix-filtered. */
export async function suggestFieldValues(
  fieldId: string,
  q: string,
  db: ValueDb = prisma,
): Promise<string[]> {
  const rows = await db.photoMetadataValue.groupBy({
    by: ["value"],
    where: {
      fieldId,
      ...(q.trim() ? { value: { startsWith: q.trim(), mode: "insensitive" as const } } : {}),
    },
    _count: { _all: true },
    take: 20,
  } as never) as Array<{ value: string; _count: { _all: number } }>;
  return rows
    .sort((a, b) => b._count._all - a._count._all)
    .map((r) => r.value);
}
