// apps/web/src/app/api/c/[catalog]/metadata/fields/[fieldId]/route.ts
import { NextResponse } from "next/server";
import { FeatureKey, FieldType } from "@lumio/shared";
import {
  deleteMetadataField,
  getCatalogSchema,
  isFeatureEnabled,
  updateMetadataField,
} from "@lumio/db";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES = new Set<string>(Object.values(FieldType));

async function ownsField(catalogId: string, fieldId: string): Promise<boolean> {
  const schema = await getCatalogSchema(catalogId);
  return schema.some((g) => g.fields.some((f) => f.id === fieldId));
}

export const PATCH = withCatalog<{ fieldId: string }>(async (request, context, { catalog }) => {
  if (!(await isFeatureEnabled(catalog.id, FeatureKey.Metadata)))
    return NextResponse.json({ error: "disabled" }, { status: 404 });
  const { fieldId } = await context.params;
  if (!(await ownsField(catalog.id, fieldId)))
    return NextResponse.json({ error: "unknown field" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as
    | { label?: string; type?: string; enabled?: boolean; suggests?: boolean; options?: unknown[] }
    | null;
  if (!body) return NextResponse.json({ error: "bad body" }, { status: 400 });
  if (body.type !== undefined && !TYPES.has(body.type))
    return NextResponse.json({ error: "bad type" }, { status: 400 });
  const data: { label?: string; type?: string; enabled?: boolean; suggests?: boolean; options?: string[] } = {};
  if (typeof body.label === "string" && body.label.trim()) data.label = body.label.trim();
  if (body.type !== undefined) data.type = body.type;
  if (typeof body.enabled === "boolean") data.enabled = body.enabled;
  if (typeof body.suggests === "boolean") data.suggests = body.suggests;
  if (Array.isArray(body.options)) data.options = body.options.filter((o: unknown): o is string => typeof o === "string" && o.trim() !== "");
  await updateMetadataField(fieldId, data);
  return NextResponse.json({ ok: true });
});

export const DELETE = withCatalog<{ fieldId: string }>(async (_request, context, { catalog }) => {
  if (!(await isFeatureEnabled(catalog.id, FeatureKey.Metadata)))
    return NextResponse.json({ error: "disabled" }, { status: 404 });
  const { fieldId } = await context.params;
  if (!(await ownsField(catalog.id, fieldId)))
    return NextResponse.json({ error: "unknown field" }, { status: 404 });
  await deleteMetadataField(fieldId);
  return NextResponse.json({ ok: true });
});
