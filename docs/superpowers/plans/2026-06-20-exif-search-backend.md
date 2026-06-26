# EXIF Search — Backend Engine & Storage (Plan 1 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the photo library queryable by any EXIF field through one unified
predicate engine, with the hot fields promoted to typed, indexed columns and every
other key reachable via JSONB — exposed over the existing `/api/search` plus new
EXIF discovery endpoints.

**Architecture:** A declarative **field registry** in `@lumio/shared` is the single
source of truth for which fields exist, where each lives (a promoted `Photo` column
or an `exif` JSONB path), and which operators are valid. A pure compiler
`buildPhotoWhere(filterSet, now)` in `@lumio/db` turns a `FilterSet`
(`{ match, rules: [{ field, op, value }] }`) into a `Prisma.PhotoWhereInput`, and
**replaces both** of today's hardcoded builders (`buildSearchWhere` and
`smartAlbumWhere`). Ingest denormalizes the hot fields into columns via one shared
`derivePromotedFields` helper; a backfill populates existing rows.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), pnpm workspaces, Prisma 6
+ PostgreSQL, Zod, Vitest. EXIF already extracted via `exifr` into `Photo.exif`
(JSONB).

**Spec:** `docs/superpowers/specs/2026-06-20-exif-search-design.md`

**Scope of this plan (Plan 1):** storage/migration/derive/backfill, the shared
registry + `FilterSet` types + `filterSetSchema`, the `buildPhotoWhere` compiler,
the search-service/smart-album refactor onto it, the API `filter` param, and the
discovery endpoints. **Out of scope** (later plans): token-syntax parsing + facet
panel UI (Plan 2); smart-album rule-builder reuse + "save search as smart album"
(Plan 3).

**Conventions for every task:** All `*.ts` imports of local modules use the `.js`
extension (ESM). Run a single test file with
`pnpm --filter <pkg> exec vitest run <relative-path>`. Commit after each task.

---

### Task 1: Promoted EXIF columns (Prisma migration)

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (Photo model, ~lines 26-47)

- [ ] **Step 1: Add columns + indexes to the Photo model**

In `model Photo`, add the new columns right after `exif Json` and add indexes at the
bottom of the model:

```prisma
  exif         Json
  cameraMake   String?
  cameraModel  String?
  lensModel    String?
  iso          Int?
  fNumber      Float?
  focalLength  Float?
  exposureTime Float?
  hasGps       Boolean?
  gpsLat       Float?
  gpsLng       Float?
  colorLabel   ColorLabel?
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt
  albums       AlbumPhoto[]

  @@index([sortDate, id])
  @@index([createdAt, id])
  @@index([hash])
  @@index([takenAt])
  @@index([cameraModel])
  @@index([lensModel])
  @@index([iso])
  @@index([fNumber])
  @@index([focalLength])
```

- [ ] **Step 2: Create and apply the migration**

Run: `pnpm --filter @lumio/db run migrate -- --name add_promoted_exif_columns`
Expected: Prisma creates `packages/db/prisma/migrations/<ts>_add_promoted_exif_columns/migration.sql` adding the nullable columns + indexes, applies it to the dev DB, and regenerates the client. (Nullable columns ⇒ existing rows migrate cleanly.)

- [ ] **Step 3: Verify types compile against the new columns**

Run: `pnpm --filter @lumio/db typecheck`
Expected: PASS (no errors; the generated `Prisma.PhotoWhereInput` now includes `iso`, `fNumber`, etc.).

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma
git commit -m "feat(db): promote hot EXIF fields to indexed Photo columns"
```

---

### Task 2: `derivePromotedFields` helper (shared, pure)

Lives in `@lumio/shared` (not ingest) so both ingest *and* the db backfill can use it
without a package cycle (`@lumio/db` must not import `@lumio/ingest`).

**Files:**
- Create: `packages/shared/src/promoted.ts`
- Create: `packages/shared/src/promoted.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/shared/src/promoted.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { derivePromotedFields } from "./promoted.js";

describe("derivePromotedFields", () => {
  it("maps curated + standard exif keys to columns", () => {
    expect(
      derivePromotedFields({
        cameraMake: "SONY",
        cameraModel: "ILCE-7M4",
        LensModel: "FE 50mm F1.8",
        ISO: 800,
        FNumber: 1.8,
        FocalLength: 50,
        ExposureTime: 0.004,
        latitude: 40.7,
        longitude: -74,
      }),
    ).toEqual({
      cameraMake: "SONY",
      cameraModel: "ILCE-7M4",
      lensModel: "FE 50mm F1.8",
      iso: 800,
      fNumber: 1.8,
      focalLength: 50,
      exposureTime: 0.004,
      hasGps: true,
      gpsLat: 40.7,
      gpsLng: -74,
    });
  });

  it("falls back to Make/Model and ISOSpeedRatings; trims; drops blanks", () => {
    const r = derivePromotedFields({ Make: " Canon ", Model: "EOS R5", ISOSpeedRatings: 100 });
    expect(r.cameraMake).toBe("Canon");
    expect(r.cameraModel).toBe("EOS R5");
    expect(r.iso).toBe(100);
  });

  it("missing / non-numeric / array values → null, hasGps false", () => {
    expect(derivePromotedFields({ ISO: "garbage", FNumber: Number.NaN })).toEqual({
      cameraMake: null, cameraModel: null, lensModel: null, iso: null,
      fNumber: null, focalLength: null, exposureTime: null,
      hasGps: false, gpsLat: null, gpsLng: null,
    });
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `pnpm --filter @lumio/shared exec vitest run src/promoted.test.ts`
Expected: FAIL ("Cannot find module './promoted.js'").

- [ ] **Step 3: Implement**

`packages/shared/src/promoted.ts`:

```ts
import type { ExifData } from "./types.js";

/** The denormalized columns derived from a photo's EXIF (mirrors the Photo
 *  columns added in the promoted-columns migration). */
export interface PromotedFields {
  cameraMake: string | null;
  cameraModel: string | null;
  lensModel: string | null;
  iso: number | null;
  fNumber: number | null;
  focalLength: number | null;
  exposureTime: number | null;
  hasGps: boolean;
  gpsLat: number | null;
  gpsLng: number | null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Map the sanitized `exif` blob → denormalized columns. Single source of truth,
 *  used by ingest on write and by the backfill for existing rows. Never throws. */
export function derivePromotedFields(exif: ExifData): PromotedFields {
  const e = exif as Record<string, unknown>;
  const gpsLat = num(e.latitude);
  const gpsLng = num(e.longitude);
  return {
    cameraMake: str(e.cameraMake) ?? str(e.Make),
    cameraModel: str(e.cameraModel) ?? str(e.Model),
    lensModel: str(e.LensModel),
    iso: num(e.ISO) ?? num(e.ISOSpeedRatings),
    fNumber: num(e.FNumber),
    focalLength: num(e.FocalLength),
    exposureTime: num(e.ExposureTime),
    hasGps: gpsLat !== null && gpsLng !== null,
    gpsLat,
    gpsLng,
  };
}
```

- [ ] **Step 4: Export it**

In `packages/shared/src/index.ts` add (follow the file's existing `export *` style):

```ts
export * from "./promoted.js";
```

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter @lumio/shared exec vitest run src/promoted.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/promoted.ts packages/shared/src/promoted.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): derivePromotedFields — exif blob → promoted columns"
```

---

### Task 3: Populate promoted columns on ingest

**Files:**
- Modify: `packages/ingest/src/store.ts:35-45` (the `data` object)
- Modify: `packages/ingest/src/store.test.ts`

- [ ] **Step 1: Update the store test to expect promoted columns**

In `packages/ingest/src/store.test.ts`, find the assertion on the `upsert` call's
`create`/`update` data and extend it to include the derived columns. Add this case
(adapt to the file's existing fake-db/spy setup — it asserts the object passed to
`db.photo.upsert`):

```ts
import { derivePromotedFields } from "@lumio/shared";

// within the existing "stores a photo" test, after building `processed`:
const expectedPromoted = derivePromotedFields(processed.exif);
// ...assert the upsert payload includes the promoted fields:
expect(upsertArg.create).toMatchObject(expectedPromoted);
expect(upsertArg.update).toMatchObject(expectedPromoted);
```

If the existing test uses a `processed.exif` with no camera/EXIF data, give it at
least one promoted value so the assertion is meaningful, e.g.
`exif: { cameraModel: "iPhone 15", ISO: 200 }`.

- [ ] **Step 2: Run it to verify failure**

Run: `pnpm --filter @lumio/ingest exec vitest run src/store.test.ts`
Expected: FAIL (upsert payload missing `cameraModel`/`iso`/...).

- [ ] **Step 3: Implement — spread derived columns into the upsert data**

In `packages/ingest/src/store.ts`, import the helper and spread it into `data`:

```ts
import { derivePromotedFields } from "@lumio/shared";
```

```ts
  const data = {
    takenAt: processed.takenAt,
    sortDate: processed.takenAt ?? new Date(),
    width: processed.width,
    height: processed.height,
    hash: processed.hash,
    thumbhash: processed.thumbhash,
    exif: processed.exif as object,
    fileSize,
    fileMtimeMs,
    ...derivePromotedFields(processed.exif),
  };
```

(`data` is used for both `create` and `update`, so re-ingest refreshes the columns.)

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @lumio/ingest exec vitest run src/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ingest/src/store.ts packages/ingest/src/store.test.ts
git commit -m "feat(ingest): write promoted EXIF columns on store"
```

---

### Task 4: Backfill promoted columns for existing rows

**Files:**
- Create: `packages/db/src/backfill-promoted.ts`
- Create: `packages/db/src/backfill-promoted.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/db/src/backfill-promoted.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { backfillPromoted } from "./backfill-promoted.js";

function fakeDb(rows: Array<{ id: string; exif: unknown }>) {
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  let served = false;
  const db = {
    photo: {
      findMany: vi.fn(async () => {
        if (served) return [];
        served = true;
        return rows;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        updates.push({ id: where.id, data });
        return { id: where.id };
      }),
    },
  };
  return { db, updates };
}

describe("backfillPromoted", () => {
  it("derives and writes columns for each row, returns the count", async () => {
    const { db, updates } = fakeDb([
      { id: "p1", exif: { cameraModel: "iPhone 15", ISO: 200 } },
      { id: "p2", exif: { Make: "Canon", FNumber: 2.8 } },
    ]);
    const n = await backfillPromoted(db as never, 1000);
    expect(n).toBe(2);
    expect(updates[0]).toMatchObject({ id: "p1", data: { cameraModel: "iPhone 15", iso: 200 } });
    expect(updates[1]!.data).toMatchObject({ cameraMake: "Canon", fNumber: 2.8 });
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `pnpm --filter @lumio/db exec vitest run src/backfill-promoted.test.ts`
Expected: FAIL ("Cannot find module './backfill-promoted.js'").

- [ ] **Step 3: Implement**

`packages/db/src/backfill-promoted.ts`:

```ts
import type { ExifData } from "@lumio/shared";
import { derivePromotedFields } from "@lumio/shared";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "./client.js";

type Db = Pick<PrismaClient, "photo">;

/**
 * One-off: recompute the promoted columns for every existing Photo from its
 * stored `exif` blob. Pages by `createdAt`/`id` cursor in batches. Idempotent.
 * Returns the number of rows updated.
 */
export async function backfillPromoted(db: Db = prisma, batchSize = 500): Promise<number> {
  let cursor: string | undefined;
  let updated = 0;
  for (;;) {
    const rows = await db.photo.findMany({
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: batchSize,
      orderBy: { id: "asc" },
      select: { id: true, exif: true },
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      await db.photo.update({
        where: { id: row.id },
        data: derivePromotedFields(row.exif as ExifData),
      });
      updated++;
    }
    cursor = rows[rows.length - 1]!.id;
    if (rows.length < batchSize) break;
  }
  return updated;
}

// CLI: `pnpm --filter @lumio/db exec tsx src/backfill-promoted.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  backfillPromoted()
    .then((n) => {
      console.log(`backfilled ${n} photos`);
      return prisma.$disconnect();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
```

> Note: the test's fake `findMany` returns the rows once then `[]`, so the cursor
> loop terminates; the real query pages by id cursor.

- [ ] **Step 4: Export it**

In `packages/db/src/index.ts` add:

```ts
export { backfillPromoted } from "./backfill-promoted.js";
```

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter @lumio/db exec vitest run src/backfill-promoted.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/backfill-promoted.ts packages/db/src/backfill-promoted.test.ts packages/db/src/index.ts
git commit -m "feat(db): backfillPromoted script for existing rows"
```

---

### Task 5: Expand the `RuleOp` operator set

**Files:**
- Modify: `packages/shared/src/enums.ts:13-17`

- [ ] **Step 1: Replace the `RuleOp` enum**

```ts
/** Supported filter/smart-album rule operators (used by buildPhotoWhere). */
export enum RuleOp {
  eq = "eq",
  ne = "ne",
  contains = "contains",
  gt = "gt",
  gte = "gte",
  lt = "lt",
  lte = "lte",
  between = "between",
  exists = "exists",
  not_exists = "not_exists",
  in_album = "in_album",
  not_in_album = "not_in_album",
  last_30_days = "last_30_days",
}
```

- [ ] **Step 2: Verify the package still type-checks**

Run: `pnpm --filter @lumio/shared typecheck`
Expected: PASS (existing `albums.ts` references only `RuleOp.eq` / `RuleOp.last_30_days`, still present).

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/enums.ts
git commit -m "feat(shared): expand RuleOp with the full operator set"
```

---

### Task 6: Field registry + `resolveField` (shared)

**Files:**
- Create: `packages/shared/src/filters.ts`
- Create: `packages/shared/src/filters.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/shared/src/filters.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FieldType, RuleOp } from "./index.js";
import { resolveField } from "./filters.js";

describe("resolveField", () => {
  it("resolves a known field by key", () => {
    const f = resolveField("iso");
    expect(f.type).toBe(FieldType.number);
    expect(f.storage).toEqual({ kind: "column", column: "iso" });
    expect(f.ops).toContain(RuleOp.gte);
  });

  it("resolves aliases (camera → cameraModel, aperture → fNumber column)", () => {
    expect(resolveField("camera").key).toBe("cameraModel");
    expect(resolveField("aperture").storage).toEqual({ kind: "column", column: "fNumber" });
  });

  it("resolves album + filename to special storage", () => {
    expect(resolveField("album").storage).toEqual({ kind: "album" });
    expect(resolveField("filename").storage).toEqual({ kind: "filename" });
  });

  it("unknown key → generic exif JSON path (any field is searchable)", () => {
    const f = resolveField("LightSource");
    expect(f.storage).toEqual({ kind: "json", path: ["LightSource"] });
    expect(f.key).toBe("exif.LightSource");
    expect(f.ops).toContain(RuleOp.contains);
  });

  it("explicit exif.<Key> strips the prefix in the JSON path", () => {
    expect(resolveField("exif.cameraModel").storage).toEqual({ kind: "json", path: ["cameraModel"] });
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `pnpm --filter @lumio/shared exec vitest run src/filters.test.ts`
Expected: FAIL ("Cannot find module './filters.js'" / `FieldType` undefined).

- [ ] **Step 3: Implement the registry**

`packages/shared/src/filters.ts`:

```ts
import { RuleOp } from "./enums.js";

/** The value-type of a searchable field — drives valid operators + UI widget. */
export enum FieldType {
  string = "string",
  number = "number",
  date = "date",
  bool = "bool",
}

export type FieldStorage =
  | { kind: "column"; column: string } // promoted Photo column
  | { kind: "json"; path: string[] } // exif JSONB path
  | { kind: "album" } // membership (special)
  | { kind: "filename" }; // Photo.path (special)

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  storage: FieldStorage;
  ops: RuleOp[];
  aliases?: string[];
}

const STR_OPS = [RuleOp.eq, RuleOp.ne, RuleOp.contains, RuleOp.exists, RuleOp.not_exists];
const NUM_OPS = [
  RuleOp.eq, RuleOp.ne, RuleOp.gt, RuleOp.gte, RuleOp.lt, RuleOp.lte,
  RuleOp.between, RuleOp.exists, RuleOp.not_exists,
];
const DATE_OPS = [RuleOp.gt, RuleOp.gte, RuleOp.lt, RuleOp.lte, RuleOp.between, RuleOp.exists, RuleOp.not_exists, RuleOp.last_30_days];

export const FIELD_REGISTRY: Record<string, FieldDef> = {
  cameraMake: { key: "cameraMake", label: "Camera make", type: FieldType.string, storage: { kind: "column", column: "cameraMake" }, ops: STR_OPS, aliases: ["make"] },
  cameraModel: { key: "cameraModel", label: "Camera", type: FieldType.string, storage: { kind: "column", column: "cameraModel" }, ops: STR_OPS, aliases: ["camera", "model"] },
  lensModel: { key: "lensModel", label: "Lens", type: FieldType.string, storage: { kind: "column", column: "lensModel" }, ops: STR_OPS, aliases: ["lens"] },
  iso: { key: "iso", label: "ISO", type: FieldType.number, storage: { kind: "column", column: "iso" }, ops: NUM_OPS },
  aperture: { key: "aperture", label: "Aperture", type: FieldType.number, storage: { kind: "column", column: "fNumber" }, ops: NUM_OPS, aliases: ["fnumber", "f"] },
  focalLength: { key: "focalLength", label: "Focal length", type: FieldType.number, storage: { kind: "column", column: "focalLength" }, ops: NUM_OPS, aliases: ["focal"] },
  exposureTime: { key: "exposureTime", label: "Shutter", type: FieldType.number, storage: { kind: "column", column: "exposureTime" }, ops: NUM_OPS, aliases: ["shutter", "exposure"] },
  takenAt: { key: "takenAt", label: "Date taken", type: FieldType.date, storage: { kind: "column", column: "takenAt" }, ops: DATE_OPS, aliases: ["date", "taken"] },
  orientation: { key: "orientation", label: "Orientation", type: FieldType.number, storage: { kind: "json", path: ["orientation"] }, ops: [RuleOp.eq, RuleOp.ne] },
  hasGps: { key: "hasGps", label: "Has location", type: FieldType.bool, storage: { kind: "column", column: "hasGps" }, ops: [RuleOp.eq], aliases: ["gps", "located"] },
  album: { key: "album", label: "Album", type: FieldType.string, storage: { kind: "album" }, ops: [RuleOp.in_album, RuleOp.not_in_album] },
  filename: { key: "filename", label: "Filename", type: FieldType.string, storage: { kind: "filename" }, ops: [RuleOp.contains, RuleOp.eq] },
};

const GENERIC_JSON_OPS = [
  RuleOp.eq, RuleOp.ne, RuleOp.contains, RuleOp.gt, RuleOp.gte, RuleOp.lt,
  RuleOp.lte, RuleOp.exists, RuleOp.not_exists,
];

const ALIAS_INDEX: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const def of Object.values(FIELD_REGISTRY)) {
    m[def.key.toLowerCase()] = def.key;
    for (const a of def.aliases ?? []) m[a.toLowerCase()] = def.key;
  }
  return m;
})();

/**
 * Resolve a field key/alias to its definition. Unknown keys and any `exif.<Key>`
 * resolve to a generic JSONB field so *any* EXIF key is searchable. The generic
 * path preserves the original casing (EXIF keys are case-sensitive).
 */
export function resolveField(key: string): FieldDef {
  const direct = ALIAS_INDEX[key.toLowerCase()];
  if (direct) return FIELD_REGISTRY[direct]!;
  const path = key.startsWith("exif.") ? key.slice("exif.".length) : key;
  return {
    key: `exif.${path}`,
    label: path,
    type: FieldType.string,
    storage: { kind: "json", path: [path] },
    ops: GENERIC_JSON_OPS,
  };
}
```

- [ ] **Step 4: Export it**

In `packages/shared/src/index.ts` add:

```ts
export * from "./filters.js";
```

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter @lumio/shared exec vitest run src/filters.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/filters.ts packages/shared/src/filters.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): EXIF field registry + resolveField"
```

---

### Task 7: `FilterSet` types + `filterSetSchema` (shared)

**Files:**
- Modify: `packages/shared/src/filters.ts` (append types + schema)
- Modify: `packages/shared/src/filters.test.ts` (append schema tests)

- [ ] **Step 1: Write the failing test (append to `filters.test.ts`)**

```ts
import { MatchType } from "./index.js";
import { filterSetSchema } from "./filters.js";

describe("filterSetSchema", () => {
  const ok = (rules: unknown) => filterSetSchema.safeParse({ match: MatchType.all, rules });

  it("accepts a valid numeric range + album rule", () => {
    expect(ok([
      { field: "iso", op: RuleOp.between, value: [200, 1600] },
      { field: "album", op: RuleOp.in_album, value: ["a1", "a2"] },
    ]).success).toBe(true);
  });

  it("accepts exists with no value", () => {
    expect(ok([{ field: "lens", op: RuleOp.exists }]).success).toBe(true);
  });

  it("rejects an operator not valid for the field", () => {
    expect(ok([{ field: "album", op: RuleOp.gt, value: 1 }]).success).toBe(false);
  });

  it("rejects between without a 2-tuple", () => {
    expect(ok([{ field: "iso", op: RuleOp.between, value: 200 }]).success).toBe(false);
  });

  it("rejects a scalar op with a missing value", () => {
    expect(ok([{ field: "iso", op: RuleOp.eq }]).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `pnpm --filter @lumio/shared exec vitest run src/filters.test.ts`
Expected: FAIL (`filterSetSchema` undefined).

- [ ] **Step 3: Implement (append to `filters.ts`)**

```ts
import { z } from "zod";
import { MatchType } from "./enums.js";

export type FilterValue =
  | string | number | boolean
  | [number, number] | [string, string]
  | string[];

export interface FilterRule {
  field: string;
  op: RuleOp;
  value?: FilterValue;
}

export interface FilterSet {
  match: MatchType;
  rules: FilterRule[];
}

const NO_VALUE_OPS = new Set<RuleOp>([RuleOp.exists, RuleOp.not_exists, RuleOp.last_30_days]);
const ALBUM_OPS = new Set<RuleOp>([RuleOp.in_album, RuleOp.not_in_album]);

const ruleSchema = z
  .object({
    field: z.string().min(1),
    op: z.nativeEnum(RuleOp),
    value: z.unknown().optional(),
  })
  .superRefine((rule, ctx) => {
    const def = resolveField(rule.field);
    if (!def.ops.includes(rule.op)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `op ${rule.op} invalid for field ${rule.field}` });
      return;
    }
    if (NO_VALUE_OPS.has(rule.op)) return; // value ignored
    if (ALBUM_OPS.has(rule.op)) {
      if (!Array.isArray(rule.value) || rule.value.some((v) => typeof v !== "string")) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "album op requires string[]" });
      }
      return;
    }
    // Strict value typing only for promoted columns whose type we know; generic
    // JSON fields stay permissive (an arbitrary EXIF key may hold any JSON scalar).
    const typedCol = def.storage.kind === "column" ? def.type : null;
    const v = rule.value;

    if (rule.op === RuleOp.between) {
      if (!Array.isArray(v) || v.length !== 2) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "between requires a [min, max] tuple" });
        return;
      }
      if (typedCol === FieldType.number && v.some((x) => typeof x !== "number" || !Number.isFinite(x))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "between on a numeric field requires finite numbers" });
      } else if (typedCol === FieldType.date && v.some((x) => typeof x !== "string")) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "between on a date field requires ISO strings" });
      }
      return;
    }

    // scalar ops (eq/ne/contains/gt/gte/lt/lte)
    if (v === undefined || v === null || Array.isArray(v)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `op ${rule.op} requires a scalar value` });
      return;
    }
    if (typedCol === FieldType.number && (typeof v !== "number" || !Number.isFinite(v))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${rule.field} requires a finite number` });
    } else if (typedCol === FieldType.bool && typeof v !== "boolean") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${rule.field} requires a boolean` });
    } else if (typedCol === FieldType.date && typeof v !== "string") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${rule.field} requires an ISO date string` });
    }
  });

export const filterSetSchema = z.object({
  match: z.nativeEnum(MatchType),
  rules: z.array(ruleSchema),
});
```

> `z` and `MatchType` are imported at the top of the appended block; if the linter
> prefers all imports at the top of the file, hoist the two `import` lines to join
> the existing `import { RuleOp } from "./enums.js";`.

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @lumio/shared exec vitest run src/filters.test.ts`
Expected: PASS (all `resolveField` + `filterSetSchema` tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/filters.ts packages/shared/src/filters.test.ts
git commit -m "feat(shared): FilterSet types + filterSetSchema validation"
```

---

### Task 8: `buildPhotoWhere` compiler (db)

**Files:**
- Create: `packages/db/src/photo-where.ts`
- Create: `packages/db/src/photo-where.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/db/src/photo-where.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MatchType, RuleOp } from "@lumio/shared";
import { buildPhotoWhere } from "./photo-where.js";

const now = new Date("2026-06-17T00:00:00.000Z");
const where = (rules: Parameters<typeof buildPhotoWhere>[0]["rules"], match = MatchType.all) =>
  buildPhotoWhere({ match, rules }, now);

describe("buildPhotoWhere", () => {
  it("empty rules → {} (whole library)", () => {
    expect(where([])).toEqual({});
  });

  it("promoted numeric range (iso between) → typed column predicate", () => {
    expect(where([{ field: "iso", op: RuleOp.between, value: [200, 1600] }])).toEqual({
      AND: [{ iso: { gte: 200, lte: 1600 } }],
    });
  });

  it("promoted gt/lt", () => {
    expect(where([{ field: "aperture", op: RuleOp.lte, value: 2.8 }])).toEqual({
      AND: [{ fNumber: { lte: 2.8 } }],
    });
  });

  it("string column contains is case-insensitive", () => {
    expect(where([{ field: "camera", op: RuleOp.contains, value: "sony" }])).toEqual({
      AND: [{ cameraModel: { contains: "sony", mode: "insensitive" } }],
    });
  });

  it("exists on a column → not null", () => {
    expect(where([{ field: "lens", op: RuleOp.exists }])).toEqual({
      AND: [{ lensModel: { not: null } }],
    });
  });

  it("hasGps eq true", () => {
    expect(where([{ field: "hasGps", op: RuleOp.eq, value: true }])).toEqual({
      AND: [{ hasGps: true }],
    });
  });

  it("album in / not_in", () => {
    expect(where([{ field: "album", op: RuleOp.in_album, value: ["a1"] }])).toEqual({
      AND: [{ albums: { some: { albumId: { in: ["a1"] } } } }],
    });
    expect(where([{ field: "album", op: RuleOp.not_in_album, value: ["a1"] }])).toEqual({
      AND: [{ albums: { none: { albumId: { in: ["a1"] } } } }],
    });
  });

  it("filename contains", () => {
    expect(where([{ field: "filename", op: RuleOp.contains, value: "beach" }])).toEqual({
      AND: [{ path: { contains: "beach", mode: "insensitive" } }],
    });
  });

  it("arbitrary exif key eq → JSON path equals", () => {
    expect(where([{ field: "exif.LightSource", op: RuleOp.eq, value: "Daylight" }])).toEqual({
      AND: [{ exif: { path: ["LightSource"], equals: "Daylight" } }],
    });
  });

  it("arbitrary exif key contains → string_contains", () => {
    expect(where([{ field: "exif.LensInfo", op: RuleOp.contains, value: "50" }])).toEqual({
      AND: [{ exif: { path: ["LensInfo"], string_contains: "50" } }],
    });
  });

  it("takenAt last_30_days → column gte cutoff", () => {
    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    expect(where([{ field: "takenAt", op: RuleOp.last_30_days }])).toEqual({
      AND: [{ takenAt: { gte: cutoff } }],
    });
  });

  it("match any → OR", () => {
    expect(
      where(
        [
          { field: "iso", op: RuleOp.gte, value: 800 },
          { field: "camera", op: RuleOp.eq, value: "iPhone" },
        ],
        MatchType.any,
      ),
    ).toEqual({
      OR: [{ iso: { gte: 800 } }, { cameraModel: { equals: "iPhone" } }],
    });
  });

  it("unsupported op for field throws", () => {
    expect(() => where([{ field: "album", op: RuleOp.gt, value: 1 }])).toThrow("unsupported rule");
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `pnpm --filter @lumio/db exec vitest run src/photo-where.test.ts`
Expected: FAIL ("Cannot find module './photo-where.js'").

- [ ] **Step 3: Implement the compiler**

`packages/db/src/photo-where.ts`:

```ts
import type { Prisma } from "@prisma/client";
import {
  type FieldDef,
  type FilterRule,
  type FilterSet,
  MatchType,
  RuleOp,
  resolveField,
} from "@lumio/shared";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Numeric/date comparison operator → Prisma range key. */
const RANGE_KEY: Partial<Record<RuleOp, "gt" | "gte" | "lt" | "lte">> = {
  [RuleOp.gt]: "gt",
  [RuleOp.gte]: "gte",
  [RuleOp.lt]: "lt",
  [RuleOp.lte]: "lte",
};

function unsupported(rule: FilterRule): never {
  throw new Error(`unsupported rule: ${rule.field}/${rule.op}`);
}

function columnClause(def: FieldDef, rule: FilterRule, now: Date): Prisma.PhotoWhereInput {
  const col = (def.storage as { column: string }).column;
  const wrap = (predicate: unknown): Prisma.PhotoWhereInput =>
    ({ [col]: predicate } as Prisma.PhotoWhereInput);

  switch (rule.op) {
    case RuleOp.eq:
      return def.type === "string"
        ? wrap({ equals: rule.value })
        : wrap(rule.value);
    case RuleOp.ne:
      return wrap({ not: rule.value });
    case RuleOp.contains:
      return wrap({ contains: rule.value, mode: "insensitive" });
    case RuleOp.gt:
    case RuleOp.gte:
    case RuleOp.lt:
    case RuleOp.lte:
      return wrap({ [RANGE_KEY[rule.op]!]: rule.value });
    case RuleOp.between: {
      const [min, max] = rule.value as [unknown, unknown];
      return wrap({ gte: min, lte: max });
    }
    case RuleOp.exists:
      return wrap({ not: null });
    case RuleOp.not_exists:
      return wrap({ equals: null });
    case RuleOp.last_30_days:
      return wrap({ gte: new Date(now.getTime() - 30 * DAY_MS) });
    default:
      return unsupported(rule);
  }
}

function jsonClause(def: FieldDef, rule: FilterRule): Prisma.PhotoWhereInput {
  const path = (def.storage as { path: string[] }).path;
  const wrap = (filter: Record<string, unknown>): Prisma.PhotoWhereInput =>
    ({ exif: { path, ...filter } } as Prisma.PhotoWhereInput);

  switch (rule.op) {
    case RuleOp.eq:
      return wrap({ equals: rule.value });
    case RuleOp.ne:
      return wrap({ not: rule.value });
    case RuleOp.contains:
      return wrap({ string_contains: rule.value });
    case RuleOp.gt:
    case RuleOp.gte:
    case RuleOp.lt:
    case RuleOp.lte:
      return wrap({ [RANGE_KEY[rule.op]!]: rule.value });
    case RuleOp.exists:
      return wrap({ not: Prisma.AnyNull });
    case RuleOp.not_exists:
      return wrap({ equals: Prisma.AnyNull });
    default:
      return unsupported(rule);
  }
}

function albumClause(rule: FilterRule): Prisma.PhotoWhereInput {
  const ids = rule.value as string[];
  if (rule.op === RuleOp.in_album) return { albums: { some: { albumId: { in: ids } } } };
  if (rule.op === RuleOp.not_in_album) return { albums: { none: { albumId: { in: ids } } } };
  return unsupported(rule);
}

function filenameClause(rule: FilterRule): Prisma.PhotoWhereInput {
  if (rule.op === RuleOp.contains) return { path: { contains: rule.value as string, mode: "insensitive" } };
  if (rule.op === RuleOp.eq) return { path: { equals: rule.value as string } };
  return unsupported(rule);
}

function compileRule(rule: FilterRule, now: Date): Prisma.PhotoWhereInput {
  const def = resolveField(rule.field);
  if (!def.ops.includes(rule.op)) unsupported(rule);
  switch (def.storage.kind) {
    case "column":
      return columnClause(def, rule, now);
    case "json":
      return jsonClause(def, rule);
    case "album":
      return albumClause(rule);
    case "filename":
      return filenameClause(rule);
  }
}

/**
 * Compile a FilterSet into a Prisma Photo where clause. Pure (no DB); `now` is
 * injected for relative-date ops. Empty rules → {} (matches the whole library).
 * Replaces both buildSearchWhere and smartAlbumWhere.
 */
export function buildPhotoWhere(filter: FilterSet, now: Date): Prisma.PhotoWhereInput {
  if (filter.rules.length === 0) return {};
  const clauses = filter.rules.map((r) => compileRule(r, now));
  return filter.match === MatchType.all ? { AND: clauses } : { OR: clauses };
}
```

> Note `def.type === "string"` compares against the `FieldType` enum's string
> value (`FieldType.string === "string"`), so the literal comparison is safe.

- [ ] **Step 4: Export it**

In `packages/db/src/index.ts` add:

```ts
export { buildPhotoWhere } from "./photo-where.js";
```

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter @lumio/db exec vitest run src/photo-where.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/photo-where.ts packages/db/src/photo-where.test.ts packages/db/src/index.ts
git commit -m "feat(db): buildPhotoWhere — unified FilterSet → Prisma compiler"
```

---

### Task 9: Refactor `smartAlbumWhere` onto `buildPhotoWhere`

**Files:**
- Modify: `packages/db/src/smart-albums.ts`
- Verify: `packages/db/src/smart-albums.test.ts` (must stay green, unchanged)

- [ ] **Step 1: Replace the body with a wrapper**

`packages/db/src/smart-albums.ts`:

```ts
import type { Prisma } from "@prisma/client";
import type { SmartAlbumRules } from "@lumio/shared";
import { buildPhotoWhere } from "./photo-where.js";

/**
 * Translate smart-album rules into a Prisma Photo where clause. Smart albums and
 * ad-hoc search share one engine (buildPhotoWhere); the only difference is the
 * empty-rules sentinel: a smart album with no rules matches nothing.
 * `now` is injected so the function stays pure and testable.
 */
export function smartAlbumWhere(rules: SmartAlbumRules, now: Date): Prisma.PhotoWhereInput {
  if (rules.rules.length === 0) return { id: { in: [] } };
  return buildPhotoWhere(rules, now);
}
```

> `SmartAlbumRules` is structurally identical to `FilterSet` (`{ match, rules }`),
> so it passes straight through. The existing tests use fields `"takenAt"`
> (last_30_days) and `"exif.cameraModel"` (eq) — both compile to the exact same
> output as before (`{ takenAt: { gte } }` and
> `{ exif: { path: ["cameraModel"], equals } }`), so the suite stays green.

- [ ] **Step 2: Run the existing smart-album tests (no edits)**

Run: `pnpm --filter @lumio/db exec vitest run src/smart-albums.test.ts`
Expected: PASS (all 5 existing tests, including the "unsupported rule" throw — `field: "x", op: "y"` resolves to a generic exif field whose ops don't include `"y"`, so `buildPhotoWhere` throws `unsupported rule`).

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/smart-albums.ts
git commit -m "refactor(db): smartAlbumWhere delegates to buildPhotoWhere"
```

---

### Task 10: Rebuild `buildSearchWhere` on the engine + `filter` support

**Files:**
- Modify: `packages/db/src/search.ts`
- Modify: `packages/db/src/search.test.ts` (existing cases stay; add `filter` cases)
- Modify: `apps/web/src/lib/search-service.ts`

- [ ] **Step 1: Extend the search test (keep existing 4 cases, add these)**

In `packages/db/src/search.test.ts` add:

```ts
import { MatchType, RuleOp } from "@lumio/shared";

it("filter rules compose with q + album under AND", () => {
  expect(
    buildSearchWhere({
      album: ["a1"],
      q: "beach",
      filter: { match: MatchType.all, rules: [{ field: "iso", op: RuleOp.gte, value: 800 }] },
    }),
  ).toEqual({
    AND: [
      { albums: { some: { albumId: { in: ["a1"] } } } },
      { path: { contains: "beach", mode: "insensitive" } },
      { iso: { gte: 800 } },
    ],
  });
});
```

> The four existing cases must keep passing unchanged — the album/q ordering and
> the `{}` empty result are preserved by the normalizer below.

- [ ] **Step 2: Run it to verify failure**

Run: `pnpm --filter @lumio/db exec vitest run src/search.test.ts`
Expected: FAIL (new `filter` case: `buildSearchWhere` doesn't accept `filter` yet).

- [ ] **Step 3: Reimplement `buildSearchWhere` as a normalizer**

`packages/db/src/search.ts`:

```ts
import type { Prisma } from "@prisma/client";
import { type FilterRule, type FilterSet, MatchType, RuleOp } from "@lumio/shared";
import { buildPhotoWhere } from "./photo-where.js";

/**
 * Translate search params into a Prisma Photo where clause via the shared
 * engine. The legacy `album` + `q` params are normalized into rules (album
 * membership, then filename contains) and concatenated with any structured
 * `filter` rules, all under match=all — preserving today's AND semantics and
 * clause ordering. Empty → {} (whole library). `now` is injected for testability.
 */
export function buildSearchWhere(
  p: { q?: string; album: string[]; filter?: FilterSet },
  now: Date = new Date(),
): Prisma.PhotoWhereInput {
  const legacy: FilterRule[] = [];
  if (p.album.length > 0) legacy.push({ field: "album", op: RuleOp.in_album, value: p.album });
  if (p.q) legacy.push({ field: "filename", op: RuleOp.contains, value: p.q });

  // No structured filter, or an all-match one: AND everything flat — preserves the
  // legacy output shape + clause ordering (album, filename, then filter rules).
  if (!p.filter || p.filter.match === MatchType.all) {
    const rules = [...legacy, ...(p.filter?.rules ?? [])];
    return buildPhotoWhere({ match: MatchType.all, rules }, now);
  }

  // any-match filter: legacy album/filename stay mandatory (AND), wrapping the
  // filter's OR group so they aren't absorbed into the OR.
  const filterClause = buildPhotoWhere(p.filter, now);
  if (legacy.length === 0) return filterClause;
  const legacyClause = buildPhotoWhere({ match: MatchType.all, rules: legacy }, now);
  return { AND: [legacyClause, filterClause] };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @lumio/db exec vitest run src/search.test.ts`
Expected: PASS (4 existing + 1 new).

- [ ] **Step 5: Thread `filter` through the search service**

In `apps/web/src/lib/search-service.ts`, `buildSearchWhere(params)` already receives
the whole `SearchQuery`; once `SearchQuery` gains `filter` (Task 11) this passes
through automatically. No code change is required here **if** `params` is forwarded
whole. Confirm both call sites forward `params`:

```ts
const where = buildSearchWhere(params);
// ...
return db.photo.count({ where: buildSearchWhere(params) });
```

(They already do — leave as-is. This step is a verification, not an edit.)

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/search.ts packages/db/src/search.test.ts
git commit -m "refactor(db): buildSearchWhere normalizes q/album/filter onto buildPhotoWhere"
```

---

### Task 11: `filter` query param on `searchQuerySchema`

**Files:**
- Modify: `packages/shared/src/api.ts:52-66`
- Modify: `packages/shared/src/api.test.ts`

- [ ] **Step 1: Write the failing test (append to `api.test.ts`)**

```ts
import { MatchType, RuleOp } from "./index.js";

describe("searchQuerySchema filter param", () => {
  it("parses a JSON filter string into a validated FilterSet", () => {
    const filter = JSON.stringify({
      match: MatchType.all,
      rules: [{ field: "iso", op: RuleOp.gte, value: 800 }],
    });
    const parsed = searchQuerySchema.parse({ filter });
    expect(parsed.filter).toEqual({
      match: MatchType.all,
      rules: [{ field: "iso", op: RuleOp.gte, value: 800 }],
    });
  });

  it("omits filter when absent", () => {
    expect(searchQuerySchema.parse({}).filter).toBeUndefined();
  });

  it("rejects malformed JSON", () => {
    expect(() => searchQuerySchema.parse({ filter: "{not json" })).toThrow();
  });

  it("rejects a filter that fails validation", () => {
    const filter = JSON.stringify({ match: MatchType.all, rules: [{ field: "album", op: RuleOp.gt, value: 1 }] });
    expect(() => searchQuerySchema.parse({ filter })).toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `pnpm --filter @lumio/shared exec vitest run src/api.test.ts`
Expected: FAIL (`parsed.filter` undefined / no validation).

- [ ] **Step 3: Add the `filter` field to the schema**

In `packages/shared/src/api.ts`, import the schema and add the field:

```ts
import { filterSetSchema } from "./filters.js";
```

Add inside the `searchQuerySchema` object (after `album`):

```ts
  filter: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v == null || v === "") return undefined;
      let json: unknown;
      try {
        json = JSON.parse(v);
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "filter is not valid JSON" });
        return z.NEVER;
      }
      const result = filterSetSchema.safeParse(json);
      if (!result.success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalid filter" });
        return z.NEVER;
      }
      return result.data;
    }),
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @lumio/shared exec vitest run src/api.test.ts`
Expected: PASS (existing + 4 new).

- [ ] **Step 5: Verify the route forwards `filter`**

`apps/web/src/app/api/search/route.ts` builds the parse input from
`Object.fromEntries(searchParams)`, which already includes a `filter` query param
(single-valued) — no route edit needed. Confirm by reading the file; the
`searchQuerySchema.safeParse({...})` now yields `parsed.data.filter`.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/api.ts packages/shared/src/api.test.ts
git commit -m "feat(shared): accept a JSON filter param on searchQuerySchema"
```

---

### Task 12: EXIF discovery endpoints

Powers dynamic facets: which keys exist, and the distinct values (+counts) for a
field. Promoted columns use Prisma `groupBy`; arbitrary keys use a raw JSONB query.

**Files:**
- Create: `apps/web/src/lib/exif-discovery.ts`
- Create: `apps/web/src/lib/exif-discovery.test.ts`
- Create: `apps/web/src/app/api/exif/values/route.ts`
- Create: `apps/web/src/app/api/exif/fields/route.ts`

- [ ] **Step 1: Write the failing test (values for a promoted column)**

`apps/web/src/lib/exif-discovery.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { distinctValues } from "./exif-discovery";

describe("distinctValues (promoted column)", () => {
  it("groupBy a column → [{ value, count }] sorted by count desc", async () => {
    const db = {
      photo: {
        groupBy: vi.fn(async () => [
          { cameraModel: "iPhone 15", _count: { _all: 3 } },
          { cameraModel: "ILCE-7M4", _count: { _all: 5 } },
          { cameraModel: null, _count: { _all: 2 } },
        ]),
      },
    };
    const out = await distinctValues("camera", db as never);
    expect(out).toEqual([
      { value: "ILCE-7M4", count: 5 },
      { value: "iPhone 15", count: 3 },
    ]);
    expect(db.photo.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ["cameraModel"], _count: { _all: true } }),
    );
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `pnpm --filter web exec vitest run src/lib/exif-discovery.test.ts`
Expected: FAIL ("Cannot find module './exif-discovery'").

> If `web`'s package name differs, use the name in `apps/web/package.json`. Confirm
> with `grep '"name"' apps/web/package.json`.

- [ ] **Step 3: Implement the discovery service**

`apps/web/src/lib/exif-discovery.ts`:

```ts
import { type PrismaClient, prisma } from "@lumio/db";
import { resolveField } from "@lumio/shared";

type Db = Pick<PrismaClient, "photo"> & { $queryRaw: PrismaClient["$queryRaw"] };

export interface ValueCount {
  value: string;
  count: number;
}

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; data: unknown }>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.data as T);
  return load().then((data) => {
    cache.set(key, { at: Date.now(), data });
    return data;
  });
}

/** Distinct values (+counts) for a field, most common first. Promoted columns use
 *  groupBy; arbitrary EXIF keys read the JSONB path. Non-null, capped at 200. */
export async function distinctValues(field: string, db: Db = prisma as Db): Promise<ValueCount[]> {
  return cached(`values:${field}`, async () => {
    const def = resolveField(field);
    if (def.storage.kind === "column") {
      const col = def.storage.column;
      const rows = (await db.photo.groupBy({
        by: [col],
        _count: { _all: true },
      } as never)) as Array<Record<string, unknown> & { _count: { _all: number } }>;
      return rows
        .filter((r) => r[col] != null)
        .map((r) => ({ value: String(r[col]), count: r._count._all }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 200);
    }
    if (def.storage.kind === "json") {
      const key = def.storage.path[0]!;
      const rows = await db.$queryRaw<Array<{ value: string; count: bigint }>>`
        SELECT exif->>${key} AS value, COUNT(*) AS count
        FROM "Photo"
        WHERE exif ? ${key} AND exif->>${key} IS NOT NULL
        GROUP BY exif->>${key}
        ORDER BY count DESC
        LIMIT 200`;
      return rows.map((r) => ({ value: r.value, count: Number(r.count) }));
    }
    return [];
  });
}

/** Distinct EXIF keys present across the library (top-level keys of the blob). */
export async function distinctFields(db: Db = prisma as Db): Promise<string[]> {
  return cached("fields", async () => {
    const rows = await db.$queryRaw<Array<{ key: string }>>`
      SELECT DISTINCT jsonb_object_keys(exif) AS key
      FROM "Photo"
      ORDER BY key`;
    return rows.map((r) => r.key);
  });
}
```

- [ ] **Step 4: Run the unit test to verify pass**

Run: `pnpm --filter web exec vitest run src/lib/exif-discovery.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the route handlers**

`apps/web/src/app/api/exif/values/route.ts`:

```ts
import { NextResponse } from "next/server";
import { distinctValues } from "@/lib/exif-discovery";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (request) => {
  const field = new URL(request.url).searchParams.get("field");
  if (!field) return NextResponse.json({ error: "field is required" }, { status: 400 });
  return NextResponse.json({ values: await distinctValues(field) });
});
```

`apps/web/src/app/api/exif/fields/route.ts`:

```ts
import { NextResponse } from "next/server";
import { distinctFields } from "@/lib/exif-discovery";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async () => {
  return NextResponse.json({ fields: await distinctFields() });
});
```

> Mirror the existing `/api/search/route.ts` for `withAuth`, `runtime`, and
> `dynamic` conventions — confirm the import path of `withAuth` matches that file.

- [ ] **Step 6: Typecheck the web app**

Run: `pnpm --filter web typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/exif-discovery.ts apps/web/src/lib/exif-discovery.test.ts apps/web/src/app/api/exif
git commit -m "feat(web): EXIF discovery endpoints (fields + values with counts)"
```

---

### Task 13: Full-suite verification + backfill run

**Files:** none (verification)

- [ ] **Step 1: Run the whole test suite**

Run: `pnpm -r test`
Expected: PASS across `@lumio/shared`, `@lumio/db`, `@lumio/ingest`, `web` (the prior ~144 tests plus everything added here).

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm -r typecheck` then your lint command (e.g. `pnpm -r lint`).
Expected: PASS. (Pre-existing `photos/photo-grid.tsx` setState-in-effect lint warnings are unrelated — do not fix here.)

- [ ] **Step 3: Backfill existing rows**

Run: `pnpm --filter @lumio/db exec tsx src/backfill-promoted.ts`
Expected: prints `backfilled <N> photos` where N = current library size. (If `tsx` isn't installed in `@lumio/db`, run via the worker's runner or add `tsx` as a dev dep — confirm how other one-off scripts in the repo are executed.)

- [ ] **Step 4: Smoke-test the API (optional, manual)**

With the dev server running and an authenticated session, e.g.:
`GET /api/search?filter={"match":"all","rules":[{"field":"iso","op":"gte","value":800}]}`
and `GET /api/exif/values?field=camera`.
Expected: filtered photos / distinct camera values with counts.

- [ ] **Step 5: Commit (if any lint autofixes)**

```bash
git add -A
git commit -m "chore: exif-search backend — full-suite green + backfill" || echo "nothing to commit"
```

---

## Self-Review (completed during authoring)

- **Spec coverage:** operators (Task 5) ✓; field registry (Task 6) ✓; promoted
  columns + backfill (Tasks 1–4) ✓; unified compiler replacing both builders
  (Tasks 8–10) ✓; `filterSetSchema` validation (Task 7) ✓; API `filter` param
  (Task 11) ✓; discovery endpoints (Task 12) ✓; smart-album reuse of the engine
  (Task 9) ✓. **Deferred to Plans 2/3:** token parsing + facet panel UI;
  smart-album rule-builder + "save search as smart album"; the promoted-column
  management UI; place-name geocoding (out of scope entirely).
- **Type consistency:** `FilterSet`/`FilterRule`/`FieldDef`/`FieldStorage`/`FieldType`
  defined in Task 6–7 and consumed unchanged in Tasks 8–11; `RuleOp` members used in
  the compiler all exist in the Task 5 enum; `buildPhotoWhere(filter, now)` signature
  consistent across Tasks 8–10; `SmartAlbumRules` is structurally `FilterSet`.
- **Back-compat guarded by existing tests:** `smart-albums.test.ts` (Task 9) and the
  four original `search.test.ts` cases (Task 10) must remain green unchanged.

---

## Follow-on plans (separate writing-plans passes)

**Plan 2 — Search UI (facets + tokens).** Pure token parse/serialize helpers in
`@lumio/shared` (`field:op?value`, `iso:>800`, `iso:200..1600`, `camera:"…"`,
`exif.LightSource:Daylight`) with round-trip tests; a `FilterSet`-aware facet panel
component (curated widgets + a generic "＋ Add filter" row fed by `/api/exif/fields`
and `/api/exif/values`); extend `search-input.tsx`'s contenteditable/`tributejs`
chips to EXIF fields; generalize `SearchFilters` + `paramsFor`/`serialize`/`scopeQuery`
in `filters.ts` to carry the `FilterSet` and emit the `filter` param.

**Plan 3 — Smart-album unification.** Replace the narrow `smartRuleSchema` with
`filterSetSchema` in `createAlbumSchema`; widen the smart-album rule type; reuse the
Plan 2 field/op/value widgets in the rule-builder dialog; add "save this search as a
smart album" from the search view. (The engine is already shared as of Task 9, so
this is mostly validation + UI.)
