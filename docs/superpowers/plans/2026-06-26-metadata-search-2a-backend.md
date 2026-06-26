# Metadata Search — Phase 2a (Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a catalog's configured metadata fields (standard EXIF-backed + custom) filterable through the existing search/smart-album rule engine, at the DB + API level (no new UI).

**Architecture:** Adopt PR #68's generic engine (`FilterSet` → `buildPhotoWhere`) by cherry-picking its single commit. Then *additively* extend it: a per-catalog field registry built from `getCatalogSchema` resolves metadata field keys to two new storage kinds — `metadata` (custom → `PhotoMetadataValue` relation-EXISTS) and `standard` (EXIF-backed → effective value: override `??` promoted EXIF column). `buildPhotoWhere` gains an **optional** trailing `registry` arg that takes precedence over the static resolver and falls back to it for the engine's own `album`/`filename` legacy rules — so every existing PR #68 test keeps passing unchanged.

**Tech Stack:** TypeScript ESM (`.js` import specifiers), Prisma 6 / Postgres, Vitest (node, DI fakes — no real DB), pnpm workspaces (`@lumio/shared`, `@lumio/db`).

**Spec:** `docs/superpowers/specs/2026-06-26-metadata-search-design.md`

**Scope correction vs spec:** `StandardFieldKey` is exactly `camera, lens, iso, shutter, aperture, focal, date` — there is **no** `hasGps`/`orientation` standard field, so there is **no bool** searchable field. Drop the bool row from the spec's §4 table.

---

## File Structure

- **Cherry-picked (PR #68), then modified:**
  - `packages/shared/src/filters.ts` — rename its local `FieldType`→`ValueType`; extend `FieldStorage` with `metadata` + `standard` kinds; export `SearchRegistry` type.
  - `packages/db/src/photo-where.ts` — add `metadata` + `standard` compile branches; `buildPhotoWhere` gains optional `registry`.
  - `packages/db/src/smart-albums.ts` — `smartAlbumWhere` gains optional `registry`.
  - `packages/db/src/search.ts` — `buildSearchWhere` gains `registry`; drop user `filter` rules whose field isn't in the registry (enforces "configured fields only").
- **Created:**
  - `packages/shared/src/search-registry.ts` — `buildSearchRegistry(schema)`, `metadataFieldToValueType`, `STANDARD_COLUMN` map.
  - `packages/shared/src/search-registry.test.ts`
  - `packages/db/src/photo-where-metadata.test.ts` — the metadata/standard compile cases.
- **Modified (this branch):**
  - `apps/web/src/lib/server/search-service.ts` — build the registry from the catalog schema, pass it down.
  - `apps/web/src/lib/server/albums-service.ts` — load the album's catalog schema → registry → `smartAlbumWhere`.

---

## Task 1: Land the PR #68 engine (cherry-pick + conflict resolution)

This is a one-time integration task, not TDD. Goal: PR #68's single commit applied on this branch, all its tests green, with the `FieldType` name collision resolved.

**Files:** the 5 overlapping files + a rename across `filters.ts`/`photo-where.ts`.

- [ ] **Step 1: Start the cherry-pick (no auto-commit)**

```bash
git cherry-pick -n cd99db30
git status   # expect conflicts in: shared/src/enums.ts, shared/src/index.ts, db/src/index.ts, db/prisma/schema.prisma, app/(app)/c/[catalog]/search/search-view.tsx
```

- [ ] **Step 2: Resolve `packages/shared/src/enums.ts`**

Keep this branch's metadata enums (`FieldType`, `FieldKind`, `MetadataValueSource`, `PhotoSource`) AND this branch's `MatchType`. Replace this branch's 2-value `RuleOp` with PR #68's full enum:

```ts
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
  in_list = "in_list",
  not_in_list = "not_in_list",
  last_30_days = "last_30_days",
}
```

- [ ] **Step 3: Resolve `shared/src/index.ts` and `db/src/index.ts`**

Take the union of both sides' `export ... from` lines (both are pure append conflicts). Ensure `export * from "./filters.js";` and `export * from "./filter-tokens.js";` are present in shared; ensure `export * from "./photo-where.js";`, `"./smart-albums.js"`, `"./promoted.js"`, `"./backfill-promoted.js"` are present in db. (The new `./search-registry.js` export is added in Task 2.)

- [ ] **Step 4: Resolve `packages/db/prisma/schema.prisma`**

Pure-additive: keep this branch's 3 metadata models AND PR #68's promoted columns on `Photo` (`cameraMake`, `cameraModel`, `lensModel`, `iso`, `fNumber`, `focalLength`, `exposureTime`, `hasGps`, `gpsLat`, `gpsLng`) + their `@@index` lines. Both edit different regions of the file. Confirm the `Photo.metadataValues PhotoMetadataValue[]` back-relation (already on this branch) is retained.

- [ ] **Step 5: Resolve `search-view.tsx`**

Keep **this branch's** version of `app/(app)/c/[catalog]/search/search-view.tsx` (`git checkout --ours` then re-add). The metadata search UI is built fresh in Phase 2b; we are not keeping PR #68's EXIF filter-panel wiring in the page.

```bash
git checkout --ours "apps/web/src/app/(app)/c/[catalog]/search/search-view.tsx"
git add "apps/web/src/app/(app)/c/[catalog]/search/search-view.tsx"
```

- [ ] **Step 6: Fix the `FieldType` collision — rename PR #68's local enum to `ValueType`**

In `packages/shared/src/filters.ts`, rename the locally-declared `enum FieldType { string, number, date, bool }` to `enum ValueType`, and replace every `FieldType.` in that file with `ValueType.`. In `packages/db/src/photo-where.ts`, change the import `FieldType` → `ValueType` and replace its single use (`def.type === FieldType.string`) with `def.type === ValueType.string`.

```bash
# after editing:
grep -rn "FieldType" packages/shared/src/filters.ts packages/db/src/photo-where.ts
# expect: no matches (filters.ts/photo-where.ts now use ValueType; metadata FieldType lives only in enums.ts)
```

- [ ] **Step 7: Stage remaining picked files and build**

```bash
git add -A
pnpm --filter @lumio/shared exec tsc --noEmit
pnpm --filter @lumio/db exec tsc --noEmit 2>&1 | grep "error TS" | grep -v "calendar.ts" || echo "db tsc clean (calendar pre-existing only)"
```
Expected: shared clean; db clean except the known pre-existing `calendar.ts` errors.

- [ ] **Step 8: Run the cherry-picked engine tests**

```bash
pnpm --filter @lumio/shared test -- filters filter-tokens promoted
pnpm --filter @lumio/db test -- photo-where smart-albums search backfill-promoted
```
Expected: all PASS (the engine arrived intact).

- [ ] **Step 9: Commit**

```bash
git commit -m "feat(search): land generic filter engine from #68 (cherry-pick cd99db30; FieldType->ValueType)"
```

---

## Task 2: Catalog field registry (`buildSearchRegistry`)

Maps a catalog's enabled metadata fields to `FieldDef`s the engine can compile. First extend the storage union, then build the registry.

**Files:**
- Modify: `packages/shared/src/filters.ts`
- Create: `packages/shared/src/search-registry.ts`
- Create: `packages/shared/src/search-registry.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Extend `FieldStorage` and export `SearchRegistry` in `filters.ts`**

Add two kinds to the `FieldStorage` union and a registry alias (place after the `FieldDef` interface):

```ts
export type FieldStorage =
  | { kind: "column"; column: string }
  | { kind: "json"; path: string[] }
  | { kind: "album" }
  | { kind: "filename" }
  | { kind: "metadata"; fieldId: string } // custom field → PhotoMetadataValue relation
  | { kind: "standard"; column: string; fieldId: string }; // EXIF-backed → effective value

/** Per-catalog field resolver: field key → its def. Built from the metadata schema. */
export type SearchRegistry = Map<string, FieldDef>;
```

- [ ] **Step 2: Write the failing test for `buildSearchRegistry`**

Create `packages/shared/src/search-registry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FieldType, FieldKind, RuleOp } from "./enums.js";
import { StandardFieldKey } from "./metadata-standard.js";
import { ValueType } from "./filters.js";
import { buildSearchRegistry } from "./search-registry.js";
import type { MetadataSchema } from "./metadata-resolve.js";

function field(p: Partial<MetadataSchema[number]["fields"][number]> & { id: string; key: string }) {
  return {
    label: p.key, type: FieldType.Text, kind: FieldKind.Custom, builtinKey: null,
    enabled: true, suggests: true, options: [], ...p,
  };
}
const schema = (fields: any[]): MetadataSchema => [{ id: "g1", label: "G", fields }];

describe("buildSearchRegistry", () => {
  it("maps a custom text field to a metadata-relation def with string ops", () => {
    const reg = buildSearchRegistry(schema([field({ id: "f1", key: "film-stock", type: FieldType.Text })]));
    const def = reg.get("film-stock")!;
    expect(def.storage).toEqual({ kind: "metadata", fieldId: "f1" });
    expect(def.type).toBe(ValueType.string);
    expect(def.ops).toContain(RuleOp.contains);
    expect(def.ops).toContain(RuleOp.in_list);
    expect(def.ops).not.toContain(RuleOp.between);
  });

  it("gives a custom number field equality/in/exists but NOT range ops", () => {
    const reg = buildSearchRegistry(schema([field({ id: "f2", key: "frames", type: FieldType.Number })]));
    const def = reg.get("frames")!;
    expect(def.type).toBe(ValueType.number);
    expect(def.ops).toEqual([RuleOp.eq, RuleOp.in_list, RuleOp.exists, RuleOp.not_exists]);
  });

  it("maps a standard camera field to the cameraModel column with effective-value string ops", () => {
    const reg = buildSearchRegistry(schema([
      field({ id: "f3", key: "camera", type: FieldType.Text, kind: FieldKind.Standard, builtinKey: StandardFieldKey.Camera }),
    ]));
    const def = reg.get("camera")!;
    expect(def.storage).toEqual({ kind: "standard", column: "cameraModel", fieldId: "f3" });
    expect(def.type).toBe(ValueType.string);
    expect(def.ops).toContain(RuleOp.contains);
  });

  it("maps a standard iso field to a numeric column with range ops", () => {
    const reg = buildSearchRegistry(schema([
      field({ id: "f4", key: "iso", type: FieldType.Number, kind: FieldKind.Standard, builtinKey: StandardFieldKey.Iso }),
    ]));
    const def = reg.get("iso")!;
    expect(def.storage).toEqual({ kind: "standard", column: "iso", fieldId: "f4" });
    expect(def.type).toBe(ValueType.number);
    expect(def.ops).toContain(RuleOp.between);
  });

  it("skips disabled fields", () => {
    const reg = buildSearchRegistry(schema([field({ id: "f5", key: "hidden", enabled: false })]));
    expect(reg.has("hidden")).toBe(false);
  });
});
```

- [ ] **Step 3: Run it — verify it fails**

Run: `pnpm --filter @lumio/shared test -- search-registry`
Expected: FAIL ("buildSearchRegistry is not a function" / module not found).

- [ ] **Step 4: Implement `buildSearchRegistry`**

Create `packages/shared/src/search-registry.ts`:

```ts
import { FieldType, FieldKind, RuleOp } from "./enums.js";
import { StandardFieldKey } from "./metadata-standard.js";
import { ValueType, type FieldDef, type SearchRegistry } from "./filters.js";
import type { MetadataSchema } from "./metadata-resolve.js";

/** Standard (EXIF-backed) field → promoted Photo column + its value type. */
export const STANDARD_COLUMN: Record<StandardFieldKey, { column: string; valueType: ValueType }> = {
  [StandardFieldKey.Camera]: { column: "cameraModel", valueType: ValueType.string },
  [StandardFieldKey.Lens]: { column: "lensModel", valueType: ValueType.string },
  [StandardFieldKey.Iso]: { column: "iso", valueType: ValueType.number },
  [StandardFieldKey.Shutter]: { column: "exposureTime", valueType: ValueType.number },
  [StandardFieldKey.Aperture]: { column: "fNumber", valueType: ValueType.number },
  [StandardFieldKey.Focal]: { column: "focalLength", valueType: ValueType.number },
  [StandardFieldKey.Date]: { column: "takenAt", valueType: ValueType.date },
};

/** Metadata field UI type → engine value type. */
export function metadataFieldToValueType(t: FieldType): ValueType {
  if (t === FieldType.Number) return ValueType.number;
  if (t === FieldType.Date) return ValueType.date;
  return ValueType.string; // text | textarea | choice
}

const STRING_OPS = [RuleOp.eq, RuleOp.contains, RuleOp.in_list, RuleOp.not_in_list, RuleOp.exists, RuleOp.not_exists];
const CHOICE_OPS = [RuleOp.eq, RuleOp.in_list, RuleOp.not_in_list, RuleOp.exists, RuleOp.not_exists];
const CUSTOM_NUM_OPS = [RuleOp.eq, RuleOp.in_list, RuleOp.exists, RuleOp.not_exists]; // no range (text-stored)
const STD_NUM_OPS = [RuleOp.eq, RuleOp.gt, RuleOp.gte, RuleOp.lt, RuleOp.lte, RuleOp.between, RuleOp.exists, RuleOp.not_exists];
const STD_DATE_OPS = [RuleOp.eq, RuleOp.gt, RuleOp.gte, RuleOp.lt, RuleOp.lte, RuleOp.between, RuleOp.last_30_days, RuleOp.exists, RuleOp.not_exists];

/**
 * Build a per-catalog field registry from the metadata schema. Only enabled
 * fields are searchable. Custom fields compile to a PhotoMetadataValue relation;
 * standard (EXIF-backed) fields to their promoted column (string ones use the
 * effective override-or-EXIF value — handled in the compiler).
 */
export function buildSearchRegistry(schema: MetadataSchema): SearchRegistry {
  const reg: SearchRegistry = new Map();
  for (const group of schema) {
    for (const f of group.fields) {
      if (!f.enabled) continue;
      if (f.kind === FieldKind.Standard && f.builtinKey) {
        const std = STANDARD_COLUMN[f.builtinKey as StandardFieldKey];
        if (!std) continue;
        const ops =
          std.valueType === ValueType.string ? STRING_OPS
          : std.valueType === ValueType.date ? STD_DATE_OPS
          : STD_NUM_OPS;
        const def: FieldDef = {
          key: f.key, label: f.label, type: std.valueType,
          storage: { kind: "standard", column: std.column, fieldId: f.id }, ops,
        };
        reg.set(f.key, def);
      } else {
        const vt = metadataFieldToValueType(f.type);
        const ops =
          f.type === FieldType.Choice ? CHOICE_OPS
          : vt === ValueType.string ? STRING_OPS
          : CUSTOM_NUM_OPS; // number | date custom → no range
        const def: FieldDef = {
          key: f.key, label: f.label, type: vt,
          storage: { kind: "metadata", fieldId: f.id }, ops,
        };
        reg.set(f.key, def);
      }
    }
  }
  return reg;
}
```

- [ ] **Step 5: Export it and run the test**

Add `export * from "./search-registry.js";` to `packages/shared/src/index.ts`.
Run: `pnpm --filter @lumio/shared test -- search-registry`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/filters.ts packages/shared/src/search-registry.ts packages/shared/src/search-registry.test.ts packages/shared/src/index.ts
git commit -m "feat(search): per-catalog field registry (metadata + standard storage kinds)"
```

---

## Task 3: Compile branches — custom relation + standard effective value

Teach `buildPhotoWhere` the two new storage kinds, behind an optional `registry`.

**Files:**
- Modify: `packages/db/src/photo-where.ts`
- Create: `packages/db/src/photo-where-metadata.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/photo-where-metadata.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MatchType, RuleOp, ValueType, type FieldDef, type SearchRegistry } from "@lumio/shared";
import { buildPhotoWhere } from "./photo-where.js";

const NOW = new Date("2026-06-26T00:00:00Z");
const custom = (key: string, fieldId: string): FieldDef =>
  ({ key, label: key, type: ValueType.string, storage: { kind: "metadata", fieldId }, ops: [] });
const standardStr = (key: string, fieldId: string, column: string): FieldDef =>
  ({ key, label: key, type: ValueType.string, storage: { kind: "standard", column, fieldId }, ops: [] });
const standardNum = (key: string, fieldId: string, column: string): FieldDef =>
  ({ key, label: key, type: ValueType.number, storage: { kind: "standard", column, fieldId }, ops: [] });
const reg = (...defs: FieldDef[]): SearchRegistry => new Map(defs.map((d) => [d.key, d]));

describe("buildPhotoWhere — custom metadata fields", () => {
  it("eq → metadataValues.some on fieldId (insensitive)", () => {
    const where = buildPhotoWhere(
      { match: MatchType.all, rules: [{ field: "film", op: RuleOp.eq, value: "Portra" }] },
      NOW, reg(custom("film", "f1")),
    );
    expect(where).toEqual({ AND: [{ metadataValues: { some: { fieldId: "f1", value: { equals: "Portra", mode: "insensitive" } } } }] });
  });
  it("contains → some.value.contains insensitive", () => {
    const where = buildPhotoWhere(
      { match: MatchType.all, rules: [{ field: "dev", op: RuleOp.contains, value: "D76" }] },
      NOW, reg(custom("dev", "f2")),
    );
    expect(where).toEqual({ AND: [{ metadataValues: { some: { fieldId: "f2", value: { contains: "D76", mode: "insensitive" } } } }] });
  });
  it("in_list → some.value.in ; not_in_list → none.value.in", () => {
    const r = reg(custom("fmt", "f3"));
    expect(buildPhotoWhere({ match: MatchType.all, rules: [{ field: "fmt", op: RuleOp.in_list, value: ["6×6", "6×7"] }] }, NOW, r))
      .toEqual({ AND: [{ metadataValues: { some: { fieldId: "f3", value: { in: ["6×6", "6×7"] } } } }] });
    expect(buildPhotoWhere({ match: MatchType.all, rules: [{ field: "fmt", op: RuleOp.not_in_list, value: ["110"] }] }, NOW, r))
      .toEqual({ AND: [{ metadataValues: { none: { fieldId: "f3", value: { in: ["110"] } } } }] });
  });
  it("exists → some.fieldId ; not_exists → none.fieldId", () => {
    const r = reg(custom("note", "f4"));
    expect(buildPhotoWhere({ match: MatchType.all, rules: [{ field: "note", op: RuleOp.exists }] }, NOW, r))
      .toEqual({ AND: [{ metadataValues: { some: { fieldId: "f4" } } }] });
    expect(buildPhotoWhere({ match: MatchType.all, rules: [{ field: "note", op: RuleOp.not_exists }] }, NOW, r))
      .toEqual({ AND: [{ metadataValues: { none: { fieldId: "f4" } } }] });
  });
});

describe("buildPhotoWhere — standard string fields (effective value)", () => {
  it("eq matches the override OR (no override AND EXIF column)", () => {
    const where = buildPhotoWhere(
      { match: MatchType.all, rules: [{ field: "camera", op: RuleOp.eq, value: "Hasselblad" }] },
      NOW, reg(standardStr("camera", "s1", "cameraModel")),
    );
    expect(where).toEqual({ AND: [{ OR: [
      { metadataValues: { some: { fieldId: "s1", value: { equals: "Hasselblad", mode: "insensitive" } } } },
      { AND: [{ metadataValues: { none: { fieldId: "s1" } } }, { cameraModel: { equals: "Hasselblad" } }] },
    ] }] });
  });
  it("exists → override exists OR column not null", () => {
    const where = buildPhotoWhere(
      { match: MatchType.all, rules: [{ field: "camera", op: RuleOp.exists }] },
      NOW, reg(standardStr("camera", "s1", "cameraModel")),
    );
    expect(where).toEqual({ AND: [{ OR: [
      { metadataValues: { some: { fieldId: "s1" } } },
      { cameraModel: { not: null } },
    ] }] });
  });
});

describe("buildPhotoWhere — standard numeric fields (typed column)", () => {
  it("between → column gte/lte", () => {
    const where = buildPhotoWhere(
      { match: MatchType.all, rules: [{ field: "iso", op: RuleOp.between, value: [200, 800] }] },
      NOW, reg(standardNum("iso", "s2", "iso")),
    );
    expect(where).toEqual({ AND: [{ iso: { gte: 200, lte: 800 } }] });
  });
});

describe("buildPhotoWhere — fallback unchanged", () => {
  it("with no registry, album/filename still resolve via the static path", () => {
    const where = buildPhotoWhere(
      { match: MatchType.all, rules: [{ field: "album", op: RuleOp.in_album, value: ["a1"] }] },
      NOW,
    );
    expect(where).toEqual({ AND: [{ albums: { some: { albumId: { in: ["a1"] } } } }] });
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm --filter @lumio/db test -- photo-where-metadata`
Expected: FAIL (`buildPhotoWhere` takes 2 args; `metadata`/`standard` kinds unhandled).

- [ ] **Step 3: Add the compile branches + optional registry in `photo-where.ts`**

Update the imports to include `ValueType` and `SearchRegistry`:

```ts
import {
  ValueType,
  type FieldDef,
  type FilterRule,
  type FilterSet,
  MatchType,
  RuleOp,
  resolveField,
  type SearchRegistry,
} from "@lumio/shared";
```

Add the two clause builders (place after `filenameClause`):

```ts
/** Custom field → EXISTS over the PhotoMetadataValue relation. */
function metadataClause(def: FieldDef, rule: FilterRule): Prisma.PhotoWhereInput {
  const fieldId = (def.storage as { fieldId: string }).fieldId;
  switch (rule.op) {
    case RuleOp.eq:
      return { metadataValues: { some: { fieldId, value: { equals: rule.value as string, mode: "insensitive" } } } };
    case RuleOp.contains:
      return { metadataValues: { some: { fieldId, value: { contains: rule.value as string, mode: "insensitive" } } } };
    case RuleOp.in_list:
      return { metadataValues: { some: { fieldId, value: { in: rule.value as string[] } } } };
    case RuleOp.not_in_list:
      return { metadataValues: { none: { fieldId, value: { in: rule.value as string[] } } } };
    case RuleOp.exists:
      return { metadataValues: { some: { fieldId } } };
    case RuleOp.not_exists:
      return { metadataValues: { none: { fieldId } } };
    default:
      return unsupported(rule);
  }
}

/** Standard field. String fields match the effective value (override ?? EXIF
 *  column); numeric/date fields compile straight onto the typed column. */
function standardClause(def: FieldDef, rule: FilterRule, now: Date): Prisma.PhotoWhereInput {
  const { column, fieldId } = def.storage as { column: string; fieldId: string };
  if (def.type !== ValueType.string) {
    // numeric/date → reuse the column compiler (typed, correct ranges)
    return columnClause(def, rule, now);
  }
  const some = (value: unknown): Prisma.PhotoWhereInput =>
    ({ metadataValues: { some: { fieldId, value } } }) as Prisma.PhotoWhereInput;
  const none = (): Prisma.PhotoWhereInput =>
    ({ metadataValues: { none: { fieldId } } }) as Prisma.PhotoWhereInput;
  const col = (predicate: unknown): Prisma.PhotoWhereInput =>
    ({ [column]: predicate }) as Prisma.PhotoWhereInput;
  const overrideAbsentAnd = (colPred: unknown): Prisma.PhotoWhereInput => ({ AND: [none(), col(colPred)] });

  switch (rule.op) {
    case RuleOp.eq:
      return { OR: [some({ equals: rule.value as string, mode: "insensitive" }), overrideAbsentAnd({ equals: rule.value })] };
    case RuleOp.contains:
      return { OR: [some({ contains: rule.value as string, mode: "insensitive" }), overrideAbsentAnd({ contains: rule.value, mode: "insensitive" })] };
    case RuleOp.in_list:
      return { OR: [some({ in: rule.value as string[] }), overrideAbsentAnd({ in: rule.value })] };
    case RuleOp.not_in_list:
      // Effective value: matches when the override is not in the list, OR there
      // is no override and the EXIF column is not in the list. (An `AND[none,…]`
      // here would wrongly drop every photo that has any override.)
      return { OR: [some({ notIn: rule.value }), overrideAbsentAnd({ notIn: rule.value })] };
    case RuleOp.exists:
      return { OR: [{ metadataValues: { some: { fieldId } } }, col({ not: null })] };
    case RuleOp.not_exists:
      return { AND: [none(), col({ equals: null })] };
    default:
      return unsupported(rule);
  }
}
```

Update `compileRule` to take an optional registry, prefer it, and dispatch the new kinds:

```ts
function compileRule(rule: FilterRule, now: Date, registry?: SearchRegistry): Prisma.PhotoWhereInput {
  const def = registry?.get(rule.field) ?? resolveField(rule.field);
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
    case "metadata":
      return metadataClause(def, rule);
    case "standard":
      return standardClause(def, rule, now);
    default:
      return unsupported(rule);
  }
}
```

> Note: a registry-supplied `def` has empty `ops: []` in tests, which would trip `if (!def.ops.includes(rule.op))`. To keep the engine permissive (op-gating is enforced at registry-build + the API boundary, not here), change that guard to skip when ops is empty: `if (def.ops.length > 0 && !def.ops.includes(rule.op)) unsupported(rule);`

Update `buildPhotoWhere` to thread the optional registry:

```ts
export function buildPhotoWhere(filter: FilterSet, now: Date, registry?: SearchRegistry): Prisma.PhotoWhereInput {
  if (filter.rules.length === 0) return {};
  const clauses = filter.rules.map((r) => compileRule(r, now, registry));
  return filter.match === MatchType.all ? { AND: clauses } : { OR: clauses };
}
```

- [ ] **Step 4: Run the new tests + the existing engine tests**

Run: `pnpm --filter @lumio/db test -- photo-where`
Expected: PASS — both `photo-where-metadata.test.ts` (new) and `photo-where.test.ts` (PR #68, unchanged, still 2-arg) green.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/photo-where.ts packages/db/src/photo-where-metadata.test.ts
git commit -m "feat(search): compile custom (relation) + standard (effective-value) metadata rules"
```

---

## Task 4: Thread the registry through search + smart albums

Wire the per-catalog registry from the request boundary into the compiler, and enforce "configured fields only".

**Files:**
- Modify: `packages/db/src/search.ts`
- Modify: `packages/db/src/smart-albums.ts`
- Modify: `apps/web/src/lib/server/search-service.ts`
- Modify: `apps/web/src/lib/server/albums-service.ts`
- Modify: `packages/db/src/search.test.ts` (extend)

- [ ] **Step 1: Write a failing test for `buildSearchWhere` registry + unknown-field drop**

Append to `packages/db/src/search.test.ts`:

```ts
import { ValueType, type FieldDef, type SearchRegistry } from "@lumio/shared";
// ...existing imports...

describe("buildSearchWhere — metadata registry", () => {
  const reg: SearchRegistry = new Map<string, FieldDef>([
    ["film", { key: "film", label: "Film", type: ValueType.string, storage: { kind: "metadata", fieldId: "f1" }, ops: [] }],
  ]);
  const NOW = new Date("2026-06-26T00:00:00Z");

  it("compiles a known metadata field via the registry", () => {
    const where = buildSearchWhere(
      { album: [], filter: { match: MatchType.all, rules: [{ field: "film", op: RuleOp.eq, value: "Portra" }] } },
      NOW, reg,
    );
    expect(JSON.stringify(where)).toContain('"fieldId":"f1"');
  });

  it("drops a filter rule whose field is not a configured field", () => {
    const where = buildSearchWhere(
      { album: [], filter: { match: MatchType.all, rules: [{ field: "exif.SecretTag", op: RuleOp.eq, value: "x" }] } },
      NOW, reg,
    );
    // unknown field removed → no rules → whole-library {}
    expect(where).toEqual({});
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm --filter @lumio/db test -- search`
Expected: FAIL (`buildSearchWhere` takes 2 args; unknown field not dropped).

- [ ] **Step 3: Add registry + field-allowlist to `buildSearchWhere`**

In `packages/db/src/search.ts`, change the signature and drop user `filter` rules whose field isn't in the registry (the system `album`/`filename` legacy rules are never dropped):

```ts
export function buildSearchWhere(
  p: { q?: string; album: string[]; filter?: FilterSet },
  now: Date = new Date(),
  registry?: SearchRegistry,
): Prisma.PhotoWhereInput {
  const legacy: FilterRule[] = [];
  if (p.album.length > 0) legacy.push({ field: "album", op: RuleOp.in_album, value: p.album });
  if (p.q) legacy.push({ field: "filename", op: RuleOp.contains, value: p.q });

  // "Configured fields only": keep only filter rules whose field is in the catalog
  // registry. With no registry (legacy callers) nothing is dropped.
  const filterRules = registry
    ? (p.filter?.rules ?? []).filter((r) => registry.has(r.field))
    : (p.filter?.rules ?? []);
  const filter = p.filter ? { match: p.filter.match, rules: filterRules } : undefined;

  if (!filter || filter.match === MatchType.all) {
    const rules = [...legacy, ...(filter?.rules ?? [])];
    return buildPhotoWhere({ match: MatchType.all, rules }, now, registry);
  }
  const filterClause = buildPhotoWhere(filter, now, registry);
  if (legacy.length === 0) return filterClause;
  const legacyClause = buildPhotoWhere({ match: MatchType.all, rules: legacy }, now, registry);
  return { AND: [legacyClause, filterClause] };
}
```

Add `SearchRegistry` to the import from `@lumio/shared`.

- [ ] **Step 4: Run — verify pass**

Run: `pnpm --filter @lumio/db test -- search`
Expected: PASS (existing + the 2 new cases).

- [ ] **Step 5: Add optional registry to `smartAlbumWhere`**

In `packages/db/src/smart-albums.ts`:

```ts
import type { SmartAlbumRules, SearchRegistry } from "@lumio/shared";

export function smartAlbumWhere(rules: SmartAlbumRules, now: Date, registry?: SearchRegistry): Prisma.PhotoWhereInput {
  if (rules.rules.length === 0) return { id: { in: [] } };
  return buildPhotoWhere(rules, now, registry);
}
```

(Existing `smart-albums` tests pass `(rules, now)` → still compile; no change needed.)

- [ ] **Step 6: Build the registry in `search-service.ts`**

In `apps/web/src/lib/server/search-service.ts`, where it calls `buildSearchWhere(...)`, first load the catalog schema and build the registry, then pass it. Add imports `getCatalogSchema` and `buildSearchRegistry` from `@lumio/db` / `@lumio/shared`. Example shape (adapt to the existing function bodies):

```ts
import { buildSearchRegistry } from "@lumio/shared";
import { getCatalogSchema } from "@lumio/db";
// inside searchPhotos / countSearchPhotos, before building the where:
const registry = buildSearchRegistry(await getCatalogSchema(catalogId));
const where = buildSearchWhere(params, new Date(), registry);
```

- [ ] **Step 7: Build the registry in `albums-service.ts`**

In `apps/web/src/lib/server/albums-service.ts`, every `smartAlbumWhere(rules, now)` call becomes registry-aware. Load the catalog schema for the album's catalog once and pass it:

```ts
import { buildSearchRegistry } from "@lumio/shared";
import { getCatalogSchema } from "@lumio/db";
// where smartAlbumWhere is called (albumPhotoWhere / albumSummary):
const registry = buildSearchRegistry(await getCatalogSchema(catalog.id));
const where = smartAlbumWhere(rules as SmartAlbumRules, new Date(), registry);
```

(If a helper is currently synchronous, make it `async` and await at call sites — follow the existing pattern in the file.)

- [ ] **Step 8: Typecheck web + db**

Run: `pnpm --filter @lumio/db exec tsc --noEmit` (clean except pre-existing calendar) and `pnpm --filter @lumio/web exec tsc --noEmit` (clean).

- [ ] **Step 9: Commit**

```bash
git add packages/db/src/search.ts packages/db/src/smart-albums.ts packages/db/src/search.test.ts apps/web/src/lib/server/search-service.ts apps/web/src/lib/server/albums-service.ts
git commit -m "feat(search): thread per-catalog registry into search + smart albums (configured fields only)"
```

---

## Task 5: Full verification

- [ ] **Step 1: Run the whole shared + db suites**

Run:
```bash
pnpm --filter @lumio/shared test
pnpm --filter @lumio/db test 2>&1 | grep -E "Test Files|Tests|FAIL"
```
Expected: all green except the 3 known pre-existing `mappers.test.ts` failures (unrelated).

- [ ] **Step 2: Typecheck all touched packages**

Run:
```bash
pnpm --filter @lumio/shared exec tsc --noEmit
pnpm --filter @lumio/db exec tsc --noEmit 2>&1 | grep "error TS" | grep -v calendar.ts || echo "db clean"
pnpm --filter @lumio/web exec tsc --noEmit 2>&1 | grep "error TS" | grep -v "\.next/" || echo "web clean"
```

- [ ] **Step 3: Manual API smoke (optional, needs dev server + a catalog with metadata)**

`GET /api/c/<catalog>/search?filter=<url-encoded {"match":"all","rules":[{"field":"<a custom field key>","op":"eq","value":"<a value you saved>"}]}>` returns the photos you tagged. A standard field (e.g. `camera`) returns photos by hand-typed override *or* EXIF.

- [ ] **Step 4: Final commit (if any verification fixups)**

```bash
git commit -am "test(search): phase 2a verification fixups" || echo "nothing to commit"
```

---

## Self-Review notes (addressed)

- **Spec coverage:** §3.1 foundation → Task 1. §3.2 registry → Task 2. §3.3 column map → Task 2 (`STANDARD_COLUMN`). §4 compiler (custom + standard effective + numeric column + ops-by-type) → Tasks 2–3. §5 API threading + configured-fields-only → Task 4. §7 smart albums → Task 4 (`smartAlbumWhere` registry). §9 tests → Tasks 2–5. §2.4 custom-numeric-range cut → `CUSTOM_NUM_OPS` excludes range (Task 2, asserted in test).
- **Spec deviation flagged:** no bool/`hasGps` standard field exists; dropped (top of plan).
- **Type consistency:** `ValueType` (renamed), `SearchRegistry = Map<string, FieldDef>`, `FieldStorage` kinds `metadata`/`standard`, `buildSearchRegistry`, `STANDARD_COLUMN`, `metadataFieldToValueType`, `buildPhotoWhere(filter, now, registry?)`, `smartAlbumWhere(rules, now, registry?)`, `buildSearchWhere(p, now, registry?)` — used consistently across tasks.
- **2b/2c** (search UI, smart-album rule builder) are separate plans, written after 2a lands.
