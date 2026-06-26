# Photo Metadata 1b-core — Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the data model, feature gate, built-in presets, pure resolve logic, and dependency-injected DB layer for custom photo metadata — everything the API + UI (next plan, 1b-ui) will sit on. No HTTP, no React.

**Architecture:** Per-catalog metadata schema = `MetadataGroup` + `MetadataField` rows (standard fields link to the 1a `STANDARD_FIELDS` registry via `builtinKey`; custom fields are user-defined). Values live in `PhotoMetadataValue` (one row per photo+field) and serve both custom values and standard-field overrides. A pure `resolvePhotoMetadata(schema, values, exif)` merges schema + stored values + EXIF into a grouped display model. All DB functions take an injected `db` param (the codebase's universal test pattern — `@lumio/db` tests never touch real Postgres), so this entire plan is unit-tested **without applying the migration to the shared dev DB**. Spec: `docs/superpowers/specs/2026-06-25-photo-metadata-design.md`.

**Tech Stack:** TypeScript (ESM, `.js` specifiers), Prisma 6 + Postgres, Vitest (node env, DI fakes), Zod, `fractional-indexing` (via `@lumio/shared`'s `ordering.ts`).

---

## ⚠️ Shared-DB guardrail (read first)

All worktrees share one Postgres (:5433). This plan **creates a migration file but DOES NOT apply it**. The DB layer is tested with injected fakes only. After Task 5, STOP and surface the migration SQL to the human; do not run `prisma migrate dev/deploy/reset` against the shared DB. `prisma generate` (client types only, no DB writes) IS used and is safe.

## File structure

- Modify `packages/shared/src/enums.ts` — add `FieldType`, `FieldKind`, `MetadataValueSource` enums.
- Modify `packages/shared/src/features.ts` — add `FeatureKey.Metadata`.
- Create `packages/shared/src/metadata-resolve.ts` (+ test) — schema/resolved types + `resolvePhotoMetadata`.
- Create `packages/shared/src/metadata-presets.ts` (+ test) — `PresetDef` types + built-in `Film`/`Digital`.
- Modify `packages/shared/src/index.ts` — re-export the two new modules.
- Modify `packages/db/prisma/schema.prisma` — `MetadataGroup`, `MetadataField`, `PhotoMetadataValue` + Catalog/Photo relations.
- Create `packages/db/prisma/migrations/20260625160000_add_metadata_tables/migration.sql` — hand-authored DDL with `COLLATE "C"` on `position`.
- Create `packages/db/src/metadata.ts` (+ test) — DI'd DB layer.
- Modify `packages/db/src/index.ts` — re-export `./metadata.js`.

---

### Task 1: Field enums (shared)

**Files:** Modify `packages/shared/src/enums.ts`

- [ ] **Step 1: Add the enums** (append to `enums.ts`, matching the file's existing enum style)

```ts
/** Data type of a metadata field. */
export enum FieldType {
  Text = "text",
  Textarea = "textarea",
  Number = "number",
  Choice = "choice",
  Date = "date",
}

/** Whether a field is a built-in standard (EXIF-backed) field or a user-defined one. */
export enum FieldKind {
  Standard = "standard",
  Custom = "custom",
}

/** Where a resolved field's value came from. */
export enum MetadataValueSource {
  Exif = "exif",
  User = "you",
  Empty = "empty",
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm --filter @lumio/shared exec tsc --noEmit` (expect no *new* errors; pre-existing `calendar.ts` errors are unrelated).

```bash
git add packages/shared/src/enums.ts
git commit -m "feat(metadata): FieldType/FieldKind/MetadataValueSource enums"
```

---

### Task 2: Register the Metadata feature gate (shared)

**Files:** Modify `packages/shared/src/features.ts`

- [ ] **Step 1: Add the enum member + registry entry**

In `FeatureKey`:

```ts
export enum FeatureKey {
  DiskExplorer = "diskExplorer",
  Metadata = "metadata",
}
```

In `FEATURES` (add after the `DiskExplorer` entry):

```ts
  [FeatureKey.Metadata]: {
    key: FeatureKey.Metadata,
    label: "Photo metadata",
    description: "Custom fields, presets, and per-catalog metadata on photos.",
    scopes: [FeatureScope.Global, FeatureScope.Catalog],
    default: false,
  },
```

- [ ] **Step 2: Run the existing feature tests (they iterate the registry) + commit**

Run: `pnpm --filter @lumio/shared test -- features` → expect PASS (registry-driven tests still green with the new key).

```bash
git add packages/shared/src/features.ts
git commit -m "feat(metadata): register Metadata feature gate"
```

---

### Task 3: Schema/resolved types + `resolvePhotoMetadata` (shared)

**Files:** Create `packages/shared/src/metadata-resolve.ts` + `packages/shared/src/metadata-resolve.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/metadata-resolve.test.ts
import { describe, expect, it } from "vitest";
import { FieldType, FieldKind, MetadataValueSource } from "./enums.js";
import { StandardFieldKey } from "./metadata-standard.js";
import { resolvePhotoMetadata, type MetadataSchema } from "./metadata-resolve.js";

const schema: MetadataSchema = [
  {
    id: "g1",
    label: "Camera & exposure",
    fields: [
      { id: "f-cam", key: "camera", label: "Camera", type: FieldType.Text, kind: FieldKind.Standard, builtinKey: StandardFieldKey.Camera, enabled: true, suggests: false },
      { id: "f-iso", key: "iso", label: "ISO", type: FieldType.Number, kind: FieldKind.Standard, builtinKey: StandardFieldKey.Iso, enabled: false, suggests: false },
    ],
  },
  {
    id: "g2",
    label: "Film",
    fields: [
      { id: "f-stock", key: "film-stock", label: "Film stock", type: FieldType.Text, kind: FieldKind.Custom, builtinKey: null, enabled: true, suggests: true },
    ],
  },
];

describe("resolvePhotoMetadata", () => {
  it("fills standard fields from exif and marks the source", () => {
    const out = resolvePhotoMetadata(schema, new Map(), { Make: "SONY", Model: "ILCE-6400" });
    expect(out).toHaveLength(2);
    const cam = out[0]!.fields[0]!;
    expect(cam.value).toBe("SONY ILCE-6400");
    expect(cam.source).toBe(MetadataValueSource.Exif);
  });

  it("omits disabled fields", () => {
    const out = resolvePhotoMetadata(schema, new Map(), {});
    expect(out[0]!.fields.map((f) => f.key)).toEqual(["camera"]); // iso is disabled
  });

  it("a stored value overrides the exif-derived standard value", () => {
    const out = resolvePhotoMetadata(schema, new Map([["f-cam", "Bronica RF645"]]), { Make: "SONY", Model: "ILCE-6400" });
    expect(out[0]!.fields[0]!.value).toBe("Bronica RF645");
    expect(out[0]!.fields[0]!.source).toBe(MetadataValueSource.User);
  });

  it("custom fields come from stored values; empty when absent", () => {
    const filled = resolvePhotoMetadata(schema, new Map([["f-stock", "Kodak Portra 400"]]), {});
    expect(filled[1]!.fields[0]).toMatchObject({ value: "Kodak Portra 400", source: MetadataValueSource.User });
    const empty = resolvePhotoMetadata(schema, new Map(), {});
    expect(empty[1]!.fields[0]).toMatchObject({ value: null, source: MetadataValueSource.Empty });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/shared test -- metadata-resolve`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/metadata-resolve.ts
import type { ExifData } from "./types.js";
import { FieldType, FieldKind, MetadataValueSource } from "./enums.js";
import { resolveStandardFields, StandardFieldKey } from "./metadata-standard.js";

/** One field's per-catalog definition (what the DB's getCatalogSchema returns). */
export interface MetadataFieldDef {
  id: string;
  key: string;
  label: string;
  type: FieldType;
  kind: FieldKind;
  /** StandardFieldKey when kind === Standard; null for custom fields. */
  builtinKey: StandardFieldKey | null;
  enabled: boolean;
  suggests: boolean;
}

export interface MetadataSchemaGroup {
  id: string;
  label: string;
  fields: MetadataFieldDef[];
}

export type MetadataSchema = MetadataSchemaGroup[];

/** A field resolved to a concrete display value for one photo. */
export interface ResolvedField {
  id: string;
  key: string;
  label: string;
  type: FieldType;
  kind: FieldKind;
  suggests: boolean;
  value: string | null;
  source: MetadataValueSource;
}

export interface ResolvedGroup {
  id: string;
  label: string;
  fields: ResolvedField[];
}

/**
 * Merge a catalog's metadata schema with a photo's stored values and its EXIF
 * into a grouped, display-ready model. Disabled fields are dropped. Standard
 * fields fall back to EXIF (via the 1a registry) unless a stored value overrides
 * them; custom fields use stored values only.
 *
 * @param values Map of fieldId → stored string value (custom values + standard overrides).
 */
export function resolvePhotoMetadata(
  schema: MetadataSchema,
  values: Map<string, string>,
  exif: ExifData,
): ResolvedGroup[] {
  const std = resolveStandardFields(exif);
  return schema.map((group) => ({
    id: group.id,
    label: group.label,
    fields: group.fields
      .filter((f) => f.enabled)
      .map((f) => {
        const stored = values.get(f.id) ?? null;
        const exifVal =
          f.kind === FieldKind.Standard && f.builtinKey ? std[f.builtinKey] : null;
        const value = stored ?? exifVal;
        const source =
          stored !== null
            ? MetadataValueSource.User
            : value !== null
              ? MetadataValueSource.Exif
              : MetadataValueSource.Empty;
        return {
          id: f.id,
          key: f.key,
          label: f.label,
          type: f.type,
          kind: f.kind,
          suggests: f.suggests,
          value,
          source,
        };
      }),
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/shared test -- metadata-resolve` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/metadata-resolve.ts packages/shared/src/metadata-resolve.test.ts
git commit -m "feat(metadata): resolvePhotoMetadata + schema/resolved types"
```

---

### Task 4: Built-in presets (shared)

**Files:** Create `packages/shared/src/metadata-presets.ts` + `packages/shared/src/metadata-presets.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/metadata-presets.test.ts
import { describe, expect, it } from "vitest";
import { FieldKind, FieldType } from "./enums.js";
import { StandardFieldKey } from "./metadata-standard.js";
import { BUILTIN_PRESETS, getPreset } from "./metadata-presets.js";

describe("built-in presets", () => {
  it("exposes Film and Digital", () => {
    expect(BUILTIN_PRESETS.map((p) => p.id).sort()).toEqual(["digital", "film"]);
  });

  it("Film mirrors NLP's four sections with the right field count", () => {
    const film = getPreset("film")!;
    expect(film.groups.map((g) => g.label)).toEqual([
      "Equipment",
      "Shooting",
      "Digitization",
      "Development",
    ]);
    const total = film.groups.reduce((n, g) => n + g.fields.length, 0);
    expect(total).toBe(27);
    // every Film field is custom
    expect(film.groups.every((g) => g.fields.every((f) => f.kind === FieldKind.Custom))).toBe(true);
    // unique keys
    const keys = film.groups.flatMap((g) => g.fields.map((f) => f.key));
    expect(new Set(keys).size).toBe(keys.length);
    // a representative field
    expect(film.groups[0]!.fields.find((f) => f.key === "film-iso")).toMatchObject({
      label: "Film ISO",
      type: FieldType.Number,
    });
  });

  it("Digital is all standard fields wired to STANDARD_FIELDS", () => {
    const digital = getPreset("digital")!;
    const fields = digital.groups.flatMap((g) => g.fields);
    expect(fields.every((f) => f.kind === FieldKind.Standard)).toBe(true);
    expect(fields.map((f) => f.builtinKey)).toContain(StandardFieldKey.Aperture);
  });

  it("getPreset returns undefined for an unknown id", () => {
    expect(getPreset("nope")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/shared test -- metadata-presets`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/metadata-presets.ts
import { FieldKind, FieldType } from "./enums.js";
import { StandardFieldKey } from "./metadata-standard.js";

export interface PresetField {
  key: string;
  label: string;
  type: FieldType;
  kind: FieldKind;
  /** Set for kind === Standard: which STANDARD_FIELDS entry this field surfaces. */
  builtinKey?: StandardFieldKey;
}

export interface PresetGroup {
  label: string;
  fields: PresetField[];
}

export interface PresetDef {
  id: string;
  name: string;
  groups: PresetGroup[];
}

const t = FieldType;
const custom = (key: string, label: string, type: FieldType = FieldType.Text): PresetField => ({
  key,
  label,
  type,
  kind: FieldKind.Custom,
});
const standard = (key: string, label: string, builtinKey: StandardFieldKey, type: FieldType): PresetField => ({
  key,
  label,
  type,
  kind: FieldKind.Standard,
  builtinKey,
});

/** Mirrors Negative Lab Pro's film-metadata sections 2–5
 *  (https://www.negativelabpro.com/guide/film-metadata/). All custom fields. */
const FILM: PresetDef = {
  id: "film",
  name: "Film",
  groups: [
    {
      label: "Equipment",
      fields: [
        custom("camera-make", "Camera Make"),
        custom("camera-model", "Camera Model"),
        custom("lens-make", "Lens Make"),
        custom("lens-model", "Lens Model"),
        custom("film-stock", "Film Stock"),
        custom("film-iso", "Film ISO", t.Number),
        custom("film-format", "Film Format", t.Choice),
        custom("gear-notes", "Gear Notes", t.Textarea),
      ],
    },
    {
      label: "Shooting",
      fields: [
        custom("shot-at-iso", "Shot at ISO", t.Number),
        custom("aperture", "Aperture", t.Number),
        custom("shutter-speed", "Shutter Speed"),
        custom("focal-length", "Focal Length", t.Number),
        custom("date", "Date", t.Date),
        custom("shooting-notes", "Shooting Notes", t.Textarea),
      ],
    },
    {
      label: "Digitization",
      fields: [
        custom("scan-method", "Scan Method", t.Choice),
        custom("scan-equipment", "Scan Equipment"),
        custom("light-source", "Light Source"),
        custom("film-holder", "Film Holder"),
        custom("digitization-notes", "Digitization Notes", t.Textarea),
      ],
    },
    {
      label: "Development",
      fields: [
        custom("push-pull", "Push-Pull", t.Choice),
        custom("developed-at", "Developed At", t.Choice),
        custom("developer", "Developer"),
        custom("dilution", "Dilution"),
        custom("dev-time-temp", "Dev Time / Temp"),
        custom("dev-method", "Dev Method"),
        custom("dev-notes", "Dev Notes", t.Textarea),
      ],
    },
  ],
};

/** Standard EXIF fields, one group. */
const DIGITAL: PresetDef = {
  id: "digital",
  name: "Digital",
  groups: [
    {
      label: "Camera & exposure",
      fields: [
        standard("camera", "Camera", StandardFieldKey.Camera, t.Text),
        standard("lens", "Lens", StandardFieldKey.Lens, t.Text),
        standard("iso", "ISO", StandardFieldKey.Iso, t.Number),
        standard("shutter", "Shutter", StandardFieldKey.Shutter, t.Text),
        standard("aperture", "Aperture", StandardFieldKey.Aperture, t.Number),
        standard("focal", "Focal length", StandardFieldKey.Focal, t.Number),
        standard("date", "Date", StandardFieldKey.Date, t.Date),
      ],
    },
  ],
};

export const BUILTIN_PRESETS: PresetDef[] = [FILM, DIGITAL];

export function getPreset(id: string): PresetDef | undefined {
  return BUILTIN_PRESETS.find((p) => p.id === id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/shared test -- metadata-presets` → PASS.

- [ ] **Step 5: Re-export both new modules from the barrel**

Add to `packages/shared/src/index.ts`:

```ts
export * from "./metadata-resolve.js";
export * from "./metadata-presets.js";
```

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @lumio/shared exec tsc --noEmit` (no new errors).

```bash
git add packages/shared/src/metadata-presets.ts packages/shared/src/metadata-presets.test.ts packages/shared/src/index.ts
git commit -m "feat(metadata): built-in Film (NLP) + Digital presets"
```

---

### Task 5: Prisma models + migration file (NOT applied) + generate

**Files:**
- Modify `packages/db/prisma/schema.prisma`
- Create `packages/db/prisma/migrations/20260625160000_add_metadata_tables/migration.sql`

- [ ] **Step 1: Add the models to `schema.prisma`**

```prisma
model MetadataGroup {
  id        String          @id @default(cuid())
  catalogId String
  catalog   Catalog         @relation(fields: [catalogId], references: [id], onDelete: Cascade)
  label     String
  position  String
  fields    MetadataField[]

  @@index([catalogId])
}

model MetadataField {
  id         String               @id @default(cuid())
  catalogId  String
  catalog    Catalog              @relation(fields: [catalogId], references: [id], onDelete: Cascade)
  groupId    String?
  group      MetadataGroup?       @relation(fields: [groupId], references: [id], onDelete: SetNull)
  key        String
  label      String
  type       String
  kind       String
  builtinKey String?
  enabled    Boolean              @default(true)
  suggests   Boolean              @default(true)
  position   String
  values     PhotoMetadataValue[]

  @@unique([catalogId, key])
  @@index([catalogId])
}

model PhotoMetadataValue {
  id      String        @id @default(cuid())
  photoId String
  photo   Photo         @relation(fields: [photoId], references: [id], onDelete: Cascade)
  fieldId String
  field   MetadataField @relation(fields: [fieldId], references: [id], onDelete: Cascade)
  value   String

  @@unique([photoId, fieldId])
  @@index([fieldId, value])
}
```

Add the back-relations to the existing `Catalog` and `Photo` models:

- In `model Catalog { ... }` add:
  ```prisma
  metadataGroups  MetadataGroup[]
  metadataFields  MetadataField[]
  ```
- In `model Photo { ... }` add:
  ```prisma
  metadataValues PhotoMetadataValue[]
  ```

- [ ] **Step 2: Hand-author the migration SQL** (`COLLATE "C"` inline on every `position`)

Create `packages/db/prisma/migrations/20260625160000_add_metadata_tables/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "MetadataGroup" (
    "id" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" TEXT NOT NULL COLLATE "C",
    CONSTRAINT "MetadataGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetadataField" (
    "id" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "groupId" TEXT,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "builtinKey" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "suggests" BOOLEAN NOT NULL DEFAULT true,
    "position" TEXT NOT NULL COLLATE "C",
    CONSTRAINT "MetadataField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoMetadataValue" (
    "id" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    CONSTRAINT "PhotoMetadataValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MetadataGroup_catalogId_idx" ON "MetadataGroup"("catalogId");
CREATE INDEX "MetadataField_catalogId_idx" ON "MetadataField"("catalogId");
CREATE UNIQUE INDEX "MetadataField_catalogId_key_key" ON "MetadataField"("catalogId", "key");
CREATE UNIQUE INDEX "PhotoMetadataValue_photoId_fieldId_key" ON "PhotoMetadataValue"("photoId", "fieldId");
CREATE INDEX "PhotoMetadataValue_fieldId_value_idx" ON "PhotoMetadataValue"("fieldId", "value");

-- AddForeignKey
ALTER TABLE "MetadataGroup" ADD CONSTRAINT "MetadataGroup_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "Catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MetadataField" ADD CONSTRAINT "MetadataField_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "Catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MetadataField" ADD CONSTRAINT "MetadataField_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "MetadataGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PhotoMetadataValue" ADD CONSTRAINT "PhotoMetadataValue_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PhotoMetadataValue" ADD CONSTRAINT "PhotoMetadataValue_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "MetadataField"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Regenerate the Prisma client (client types only — safe, no DB writes)**

Run: `pnpm --filter @lumio/db exec prisma generate`
Expected: client regenerates; `prisma.metadataField` / `metadataGroup` / `photoMetadataValue` now exist on the client type.

- [ ] **Step 4: Verify the migration is NOT applied + schema validates**

Run: `pnpm --filter @lumio/db exec prisma validate` → "The schema is valid".
**Do NOT run `prisma migrate`.** Leave the migration pending; the human applies it deliberately to the shared DB later.

- [ ] **Step 5: Commit (schema + migration, unapplied)**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260625160000_add_metadata_tables/migration.sql
git commit -m "feat(metadata): MetadataGroup/Field/PhotoMetadataValue models + migration (unapplied)"
```

- [ ] **Step 6: STOP — surface the migration to the human**

Report that the migration file is authored but **not applied** to the shared DB, and paste its path. Continue to Task 6 (unit tests don't need the tables); the human decides when to apply.

---

### Task 6: DB layer (`packages/db/src/metadata.ts`) — dependency-injected

**Files:** Create `packages/db/src/metadata.ts` + `packages/db/src/metadata.test.ts`. Modify `packages/db/src/index.ts`.

Follow the codebase's DI pattern exactly (see `packages/db/src/features.ts` / `catalogs.ts`): every function takes a `db` param defaulting to the real `prisma`, and tests pass fakes.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/db/src/metadata.test.ts
import { describe, expect, it, vi } from "vitest";
import { FieldKind, FieldType, getPreset } from "@lumio/shared";
import {
  getCatalogSchema,
  applyMetadataPreset,
  upsertPhotoMetadataValue,
  getPhotoMetadataValues,
  suggestFieldValues,
} from "./metadata.js";

describe("getCatalogSchema", () => {
  it("groups ordered fields under their groups, in position order", async () => {
    const db = {
      metadataGroup: {
        findMany: async () => [
          { id: "g1", label: "Film", position: "a0" },
          { id: "g2", label: "Process", position: "a1" },
        ],
      },
      metadataField: {
        findMany: async () => [
          { id: "f1", groupId: "g1", key: "film-stock", label: "Film stock", type: "text", kind: "custom", builtinKey: null, enabled: true, suggests: true, position: "a0" },
          { id: "f2", groupId: "g2", key: "developer", label: "Developer", type: "text", kind: "custom", builtinKey: null, enabled: true, suggests: true, position: "a0" },
        ],
      },
    } as never;
    const schema = await getCatalogSchema("cat1", db);
    expect(schema.map((g) => g.label)).toEqual(["Film", "Process"]);
    expect(schema[0]!.fields[0]!.key).toBe("film-stock");
    expect(schema[1]!.fields[0]!.key).toBe("developer");
  });
});

describe("applyMetadataPreset", () => {
  it("creates one group per preset group and one field per field, with ordered positions", async () => {
    const created: { groups: any[]; fields: any[] } = { groups: [], fields: [] };
    let gid = 0;
    const db = {
      $transaction: async (fn: (tx: any) => Promise<unknown>) =>
        fn({
          metadataGroup: { create: async ({ data }: any) => { const row = { id: `g${++gid}`, ...data }; created.groups.push(row); return row; } },
          metadataField: { create: async ({ data }: any) => { created.fields.push(data); return data; } },
        }),
    } as never;

    await applyMetadataPreset("cat1", getPreset("film")!, db);

    expect(created.groups).toHaveLength(4);
    expect(created.fields).toHaveLength(27);
    // positions sort in creation order under byte collation
    const gPos = created.groups.map((g) => g.position);
    expect([...gPos].sort()).toEqual(gPos);
    // every field carries the catalog + its group + kind
    expect(created.fields.every((f) => f.catalogId === "cat1")).toBe(true);
    const stock = created.fields.find((f) => f.key === "film-stock");
    expect(stock).toMatchObject({ label: "Film Stock", type: FieldType.Text, kind: FieldKind.Custom });
  });
});

describe("upsertPhotoMetadataValue", () => {
  it("updates an existing row, else creates it (NULL-safe, like setFeature)", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const create = vi.fn().mockResolvedValue({});
    const db = { photoMetadataValue: { updateMany, create } } as never;
    await upsertPhotoMetadataValue("p1", "f1", "Kodak Portra 400", db);
    expect(updateMany).toHaveBeenCalledWith({ where: { photoId: "p1", fieldId: "f1" }, data: { value: "Kodak Portra 400" } });
    expect(create).toHaveBeenCalledWith({ data: { photoId: "p1", fieldId: "f1", value: "Kodak Portra 400" } });
  });

  it("does not create when an update hit a row", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const create = vi.fn();
    const db = { photoMetadataValue: { updateMany, create } } as never;
    await upsertPhotoMetadataValue("p1", "f1", "x", db);
    expect(create).not.toHaveBeenCalled();
  });

  it("deletes the row when value is empty", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = { photoMetadataValue: { deleteMany } } as never;
    await upsertPhotoMetadataValue("p1", "f1", "", db);
    expect(deleteMany).toHaveBeenCalledWith({ where: { photoId: "p1", fieldId: "f1" } });
  });
});

describe("getPhotoMetadataValues", () => {
  it("returns a fieldId→value map", async () => {
    const db = { photoMetadataValue: { findMany: async () => [{ fieldId: "f1", value: "a" }, { fieldId: "f2", value: "b" }] } } as never;
    const map = await getPhotoMetadataValues("p1", db);
    expect(map.get("f1")).toBe("a");
    expect(map.get("f2")).toBe("b");
  });
});

describe("suggestFieldValues", () => {
  it("returns distinct prior values for a field, most-used first", async () => {
    const groupBy = vi.fn().mockResolvedValue([
      { value: "Kodak Portra 400", _count: { _all: 12 } },
      { value: "Kodak Gold 200", _count: { _all: 3 } },
    ]);
    const db = { photoMetadataValue: { groupBy } } as never;
    const out = await suggestFieldValues("f1", "kod", db);
    expect(out).toEqual(["Kodak Portra 400", "Kodak Gold 200"]);
    expect(groupBy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @lumio/db test -- metadata`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/db/src/metadata.ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @lumio/db test -- metadata` → PASS.

- [ ] **Step 5: Re-export + typecheck + commit**

Add to `packages/db/src/index.ts`:

```ts
export * from "./metadata.js";
```

Run: `pnpm --filter @lumio/db exec tsc --noEmit` (expect no new errors).

```bash
git add packages/db/src/metadata.ts packages/db/src/metadata.test.ts packages/db/src/index.ts
git commit -m "feat(metadata): DI'd DB layer (schema, apply-preset, values, suggest)"
```

---

### Task 7: Full-suite verification

- [ ] **Step 1: Run the touched suites**

Run: `pnpm --filter @lumio/shared test && pnpm --filter @lumio/db test`
Expected: all green (the 3 pre-existing `mappers.test.ts` `version` failures, if present, are unrelated main bugs — note, don't fix).

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @lumio/shared exec tsc --noEmit && pnpm --filter @lumio/db exec tsc --noEmit`
Expected: only the pre-existing `calendar.ts` errors in shared; nothing new; db clean.

- [ ] **Step 3: Confirm the migration is still unapplied**

The shared DB must be untouched. Confirm no `prisma migrate` was run. The feature is dormant until (a) the migration is applied and (b) the `Metadata` gate is enabled on a catalog — both happen later.

---

## Self-review

- **Spec coverage:** field model (standard|custom, groups, types, enable/suggests) ✓; presets as starter schemas (Film=NLP sections, Digital=standard) ✓; value store + override-via-same-table ✓; resolve (standard←EXIF, override, custom) ✓; autocomplete source (`suggestFieldValues`) ✓; feature gate registered ✓; `COLLATE "C"` ordering ✓; migration authored-not-applied per shared-DB guardrail ✓. Out of scope (next plan, 1b-ui): API routes, Info-tab editing UI, apply-preset trigger UI. Out of scope (1b-scale): schema-builder page, bulk-fill, upload panel, save-as-preset, standard enable/disable UI.
- **Placeholders:** none — all code + tests are concrete.
- **Type consistency:** `MetadataSchema`/`MetadataFieldDef` defined in Task 3 are consumed identically by `getCatalogSchema` (Task 6) and `resolvePhotoMetadata` (Task 3). `PresetDef`/`PresetField` (Task 4) consumed by `applyMetadataPreset` (Task 6). Enum names (`FieldType`, `FieldKind`, `MetadataValueSource`) consistent across Tasks 1/3/4/6. `keysBetween` signature matches `ordering.ts`.

## Next plan (1b-ui, not this one)

Gated API routes (`GET schema`, `POST apply-preset`, `GET photo values` (resolved), `PUT value`, `GET suggest`) using `withCatalog` + `isFeatureEnabled`; Info-tab custom-field section (display + inline edit + autocomplete) behind `<FeatureGate feature={FeatureKey.Metadata}>`; a minimal "Set up metadata → Film / Digital" empty-state that calls apply-preset. Then 1b-scale (settings builder, bulk-fill, upload panel).
