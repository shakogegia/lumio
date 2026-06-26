# Metadata Date-Field Sort Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the photo grid sort by any enabled custom-metadata **Date** field, newest- or oldest-first, in every scope (Library, Folder, Album, Smart album, Search), with the detail-view filmstrip/arrows following the same order.

**Architecture:** Custom values live in the `PhotoMetadataValue` child table, which a Prisma `orderBy` on the `Photo` query cannot reach. For a `meta:<fieldId>:<dir>` sort we query **from the value side** (`photoMetadataValue.findMany`) and nest each scope's existing `Prisma.PhotoWhereInput` verbatim under `photo:`. Photos with no value form a second segment ordered by `id`, concatenated after the valued segment (nulls-last). All scopes already funnel through `listPhotosForWhere` (grid) and `getNeighborsForWhere` (detail strip), so the branch lives in those two functions only — no raw SQL, no per-scope work.

**Tech Stack:** TypeScript, Next.js (App Router), Prisma/Postgres, Zod, React, vitest. Monorepo: `@lumio/shared` (pure helpers + schemas), `@lumio/db` (Prisma), `apps/web` (Next app).

**Design doc:** `docs/superpowers/specs/2026-06-26-metadata-date-field-sort-design.md`

---

## Background the worker needs

- **Sort encoding today:** `packages/shared/src/api.ts` exports `PHOTO_SORTS` (6 fixed strings), `PhotoSort`, `DEFAULT_PHOTO_SORT = "imported-desc"`, `coercePhotoSort` (lenient, for localStorage/detail URLs), and `photoSortSchema = z.enum(PHOTO_SORTS)` (strict, used by `photosQuerySchema` + `searchQuerySchema`).
- **Server ordering choke points:** `apps/web/src/lib/server/photos-service.ts` — `listPhotosForWhere(catalogId, where, {limit,offset,sort}, db)` runs the grid query; `getNeighborsForWhere(current, where, sort, window, db)` runs the detail strip via keyset cursoring. `photoOrderBy(sort)` (in `apps/web/src/lib/photo-order.ts`) maps a fixed sort → Prisma `orderBy`; it returns the default ordering for any unrecognized value (its `switch` falls through to `default`).
- **Every scope is a plain `Prisma.PhotoWhereInput`** (verified): library/favorites/month build it inline; folder = `{ dirPath }`; album = `albumPhotoWhere`; smart album = `smartAlbumWhere`; search = `buildSearchWhere`. They all call `listPhotosForWhere`. The detail loader (`apps/web/src/lib/server/photo-detail-loader.ts`) calls `getPhotoNeighbors`/`getNeighborsForWhere` with a `where` that always includes `catalogId` as a string.
- **Storage:** `PhotoMetadataValue` (`packages/db/prisma/schema.prisma`) has `value String`, `numValue Float?`, `@@unique([photoId, fieldId])` (so ≤1 row per photo per field — Prisma accessor `photoId_fieldId`), `@@index([fieldId, value])`. Date values are written as ISO `YYYY-MM-DD` by the picker (`apps/web/src/components/metadata/metadata-value-input.tsx`), and ISO text sorts chronologically.
- **Field schema:** `FieldType` enum (`packages/shared/src/enums.ts`) has `Date = "date"`. `MetadataField.type` is stored as that string. Client schema is available warm via `useCatalogMetadataSchema(slug)` (`apps/web/src/features/lightbox/use-metadata-schema.ts`); `MetadataSchema` is `{ id; label; fields: MetadataFieldDef[] }[]` and `MetadataFieldDef` has `{ id, label, type, enabled, ... }`.
- **Client sort state:** `useGridSort()` (`apps/web/src/lib/hooks/use-grid-sort.ts`) is a global localStorage value parsed via `parseGridSort` → `coercePhotoSort`. `GridSortMenu` (`apps/web/src/components/grid-sort-menu.tsx`) renders the radio group. Two hosts render the menu: `PhotoLibraryView` (used by library, favorites, folders, album, folder-photos) and `SearchView`. Both also call `useCatalog()` → `{ slug }` (`@/components/providers/catalog-context`).
- **Test style:** vitest with hand-rolled fake `db` objects (see `apps/web/src/lib/server/photos-service.test.ts`); pure helpers tested directly (see `apps/web/src/lib/photo-order.test.ts`). Run web tests with `pnpm --filter @lumio/web test`, shared with `pnpm --filter @lumio/shared test`.

## File structure (what changes and why)

**Modified — shared:**
- `packages/shared/src/api.ts` — widen `PhotoSort`, add `isPhotoSort`/`metadataSort`/`parseMetadataSort`, widen `coercePhotoSort`, change `photoSortSchema` to accept `meta:` values.

**New — shared test:**
- `packages/shared/src/photo-sort.test.ts`

**New — web client pure helpers + test:**
- `apps/web/src/lib/grid-sort.ts` — `dateSortFields`, `effectiveGridSort` (+ `DateSortField` type).
- `apps/web/src/lib/grid-sort.test.ts`

**New — web server module + test:**
- `apps/web/src/lib/server/metadata-sort.ts` — `resolveSort`, `metadataPageSlice`, `listPhotosByMetadata`, `metadataSortIndexOf`, `metadataNeighbors`.
- `apps/web/src/lib/server/metadata-sort.test.ts`

**Modified — web server:**
- `apps/web/src/lib/server/photos-service.ts` — branch `listPhotosForWhere` + `getNeighborsForWhere` onto the resolved sort; widen `Db`/`NeighborDb` types.

**Modified — web client UI:**
- `apps/web/src/components/grid-sort-menu.tsx` — `dateFields` prop + radio groups + widened guard.
- `apps/web/src/components/photo-library/photo-library-view.tsx` — source date fields + effective sort.
- `apps/web/src/app/(app)/c/[catalog]/search/search-view.tsx` — same.

No migration, no schema.prisma change.

---

## Task 1: Shared sort encoding + schema widening

**Files:**
- Modify: `packages/shared/src/api.ts`
- Test: `packages/shared/src/photo-sort.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/photo-sort.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  coercePhotoSort,
  DEFAULT_PHOTO_SORT,
  isPhotoSort,
  metadataSort,
  parseMetadataSort,
} from "./api.js";

describe("metadataSort / parseMetadataSort", () => {
  it("round-trips a field id and direction", () => {
    expect(metadataSort("clx1abc", "desc")).toBe("meta:clx1abc:desc");
    expect(parseMetadataSort("meta:clx1abc:desc")).toEqual({ fieldId: "clx1abc", dir: "desc" });
    expect(parseMetadataSort("meta:clx1abc:asc")).toEqual({ fieldId: "clx1abc", dir: "asc" });
  });

  it("returns null for fixed sorts, malformed values, and undefined", () => {
    expect(parseMetadataSort("taken-desc")).toBeNull();
    expect(parseMetadataSort("meta:clx1abc")).toBeNull();
    expect(parseMetadataSort("meta::asc")).toBeNull();
    expect(parseMetadataSort("meta:clx1abc:sideways")).toBeNull();
    expect(parseMetadataSort(undefined)).toBeNull();
  });
});

describe("isPhotoSort", () => {
  it("accepts fixed sorts and well-formed metadata sorts", () => {
    expect(isPhotoSort("imported-desc")).toBe(true);
    expect(isPhotoSort("meta:clx1abc:asc")).toBe(true);
  });
  it("rejects everything else", () => {
    expect(isPhotoSort("nope")).toBe(false);
    expect(isPhotoSort("meta:clx1abc")).toBe(false);
    expect(isPhotoSort(42)).toBe(false);
    expect(isPhotoSort(undefined)).toBe(false);
  });
});

describe("coercePhotoSort", () => {
  it("passes through fixed and metadata sorts, defaults otherwise", () => {
    expect(coercePhotoSort("taken-asc")).toBe("taken-asc");
    expect(coercePhotoSort("meta:clx1abc:desc")).toBe("meta:clx1abc:desc");
    expect(coercePhotoSort("garbage")).toBe(DEFAULT_PHOTO_SORT);
    expect(coercePhotoSort(null)).toBe(DEFAULT_PHOTO_SORT);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/shared test -- photo-sort`
Expected: FAIL — `isPhotoSort`, `metadataSort`, `parseMetadataSort` are not exported.

- [ ] **Step 3: Edit `packages/shared/src/api.ts`**

Replace the current `PhotoSort` type, `photoSortSchema`, and `coercePhotoSort` block (lines ~17–31) with:

```ts
export type PhotoSort =
  | (typeof PHOTO_SORTS)[number]
  | `meta:${string}:asc`
  | `meta:${string}:desc`;

/** The default ordering: newest imported-date first. */
export const DEFAULT_PHOTO_SORT: PhotoSort = "imported-desc";

/** `meta:<fieldId>:<dir>` — sort by a custom metadata field's value. fieldId is a
 *  cuid (lowercase alphanumeric); dir is asc|desc. Single regex for test+parse. */
const META_SORT_RE = /^meta:([a-z0-9]+):(asc|desc)$/;

/** Build a metadata-field sort token. */
export function metadataSort(fieldId: string, dir: "asc" | "desc"): PhotoSort {
  return `meta:${fieldId}:${dir}`;
}

/** Parse a metadata-field sort token, or null if it is not one. */
export function parseMetadataSort(
  sort: string | undefined,
): { fieldId: string; dir: "asc" | "desc" } | null {
  const m = sort ? META_SORT_RE.exec(sort) : null;
  return m ? { fieldId: m[1]!, dir: m[2] as "asc" | "desc" } : null;
}

/** A valid sort token: a fixed sort or a well-formed metadata sort. Field
 *  existence is validated server-side (see resolveSort). */
export function isPhotoSort(value: unknown): value is PhotoSort {
  return (
    (typeof value === "string" && META_SORT_RE.test(value)) ||
    (PHOTO_SORTS as readonly unknown[]).includes(value)
  );
}

/** Zod schema for a sort value (used in API query schemas). Accepts fixed and
 *  metadata sorts; rejects malformed input. */
export const photoSortSchema = z.custom<PhotoSort>((v) => isPhotoSort(v), {
  message: "invalid sort",
});

/** Coerce arbitrary input to a known sort, falling back to the default.
 *  Lenient (never throws) — for localStorage and detail-route query params. */
export function coercePhotoSort(value: unknown): PhotoSort {
  return isPhotoSort(value) ? value : DEFAULT_PHOTO_SORT;
}
```

(`PHOTO_SORTS` and the `z` import above stay as-is. `photosQuerySchema.sort` and `searchQuerySchema.sort` already reference `photoSortSchema`, so they pick up the change automatically.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/shared test -- photo-sort`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Typecheck shared**

Run: `pnpm --filter @lumio/shared build` (or `pnpm -w typecheck` if defined)
Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/api.ts packages/shared/src/photo-sort.test.ts
git commit -m "feat(shared): metadata-field sort encoding (meta:<fieldId>:<dir>)"
```

---

## Task 2: Client pure helpers (date fields + effective sort)

**Files:**
- Create: `apps/web/src/lib/grid-sort.ts`
- Test: `apps/web/src/lib/grid-sort.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/grid-sort.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FieldType, type MetadataSchema } from "@lumio/shared";
import { dateSortFields, effectiveGridSort } from "./grid-sort";

function field(id: string, type: FieldType, enabled = true) {
  return { id, key: id, label: `L-${id}`, type, kind: "custom" as const, builtinKey: null, enabled, suggests: false, options: [] };
}

const schema: MetadataSchema = [
  { id: "g1", label: "G1", fields: [field("d1", FieldType.Date), field("t1", FieldType.Text)] },
  { id: "g2", label: "G2", fields: [field("d2", FieldType.Date), field("d3", FieldType.Date, false)] },
];

describe("dateSortFields", () => {
  it("returns enabled Date fields flattened across groups", () => {
    expect(dateSortFields(schema)).toEqual([
      { id: "d1", label: "L-d1" },
      { id: "d2", label: "L-d2" },
    ]);
  });
});

describe("effectiveGridSort", () => {
  const fields = [{ id: "d1", label: "L-d1" }];
  it("keeps a fixed sort untouched", () => {
    expect(effectiveGridSort("taken-desc", fields)).toBe("taken-desc");
  });
  it("keeps a metadata sort whose field is present", () => {
    expect(effectiveGridSort("meta:d1:asc", fields)).toBe("meta:d1:asc");
  });
  it("falls back when the metadata field is absent from this catalog", () => {
    expect(effectiveGridSort("meta:zzz:asc", fields)).toBe("imported-desc");
  });
  it("keeps a metadata sort as-is while fields are still loading (undefined)", () => {
    expect(effectiveGridSort("meta:zzz:asc", undefined)).toBe("meta:zzz:asc");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/web test -- grid-sort`
Expected: FAIL — `./grid-sort` does not exist.

- [ ] **Step 3: Create `apps/web/src/lib/grid-sort.ts`**

```ts
import {
  DEFAULT_PHOTO_SORT,
  FieldType,
  type MetadataSchema,
  parseMetadataSort,
  type PhotoSort,
} from "@lumio/shared";

export interface DateSortField {
  id: string;
  label: string;
}

/** Enabled Date custom fields for a catalog, flattened from the schema groups,
 *  in schema order — the sortable date fields offered in the grid sort menu. */
export function dateSortFields(schema: MetadataSchema): DateSortField[] {
  return schema
    .flatMap((g) => g.fields)
    .filter((f) => f.enabled && f.type === FieldType.Date)
    .map((f) => ({ id: f.id, label: f.label }));
}

/** Resolve a stored sort against this catalog's date fields. A metadata sort
 *  whose field is not present (different catalog / deleted) falls back to the
 *  default so the menu selection and the grid order stay consistent. `fields`
 *  undefined = schema not loaded yet → keep the stored sort untouched. */
export function effectiveGridSort(
  sort: PhotoSort,
  fields: DateSortField[] | undefined,
): PhotoSort {
  const meta = parseMetadataSort(sort);
  if (!meta || !fields) return sort;
  return fields.some((f) => f.id === meta.fieldId) ? sort : DEFAULT_PHOTO_SORT;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/web test -- grid-sort`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/grid-sort.ts apps/web/src/lib/grid-sort.test.ts
git commit -m "feat(web): date-field + effective-sort grid helpers"
```

---

## Task 3: Server — `metadataPageSlice` + `resolveSort`

**Files:**
- Create: `apps/web/src/lib/server/metadata-sort.ts`
- Test: `apps/web/src/lib/server/metadata-sort.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/server/metadata-sort.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PHOTO_SORT } from "@lumio/shared";
import { metadataPageSlice, resolveSort } from "./metadata-sort.js";

describe("metadataPageSlice", () => {
  it("reads entirely within segment 1", () => {
    expect(metadataPageSlice(0, 2, 5)).toEqual({ seg1: { skip: 0, take: 2 }, seg2: null });
  });
  it("straddles the boundary", () => {
    expect(metadataPageSlice(4, 3, 5)).toEqual({ seg1: { skip: 4, take: 1 }, seg2: { skip: 0, take: 2 } });
  });
  it("reads entirely within segment 2", () => {
    expect(metadataPageSlice(7, 3, 5)).toEqual({ seg1: null, seg2: { skip: 2, take: 3 } });
  });
  it("starts exactly at the boundary", () => {
    expect(metadataPageSlice(5, 3, 5)).toEqual({ seg1: null, seg2: { skip: 0, take: 3 } });
  });
  it("handles an empty segment 1", () => {
    expect(metadataPageSlice(0, 2, 0)).toEqual({ seg1: null, seg2: { skip: 0, take: 2 } });
  });
  it("handles a window that exhausts segment 1 with no segment 2 rows requested elsewhere", () => {
    expect(metadataPageSlice(0, 10, 3)).toEqual({ seg1: { skip: 0, take: 3 }, seg2: { skip: 0, take: 7 } });
  });
});

describe("resolveSort", () => {
  const fieldDb = (found: boolean) => ({
    metadataField: { findFirst: vi.fn(async () => (found ? { id: "d1" } : null)) },
  });

  it("returns standard for a fixed sort without querying fields", async () => {
    const db = fieldDb(true);
    const r = await resolveSort("cat1", "taken-asc", db as never);
    expect(r).toEqual({ kind: "standard", sort: "taken-asc" });
    expect(db.metadataField.findFirst).not.toHaveBeenCalled();
  });

  it("returns metadata when the Date field exists and is enabled", async () => {
    const db = fieldDb(true);
    const r = await resolveSort("cat1", "meta:d1:desc", db as never);
    expect(r).toEqual({ kind: "metadata", fieldId: "d1", dir: "desc" });
    expect(db.metadataField.findFirst).toHaveBeenCalledWith({
      where: { id: "d1", catalogId: "cat1", enabled: true, type: "date" },
      select: { id: true },
    });
  });

  it("falls back to the standard default ordering when the field is missing/disabled/wrong-type", async () => {
    const db = fieldDb(false);
    const r = await resolveSort("cat1", "meta:d1:desc", db as never);
    expect(r).toEqual({ kind: "standard", sort: DEFAULT_PHOTO_SORT });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/web test -- metadata-sort`
Expected: FAIL — `./metadata-sort` does not exist.

- [ ] **Step 3: Create `apps/web/src/lib/server/metadata-sort.ts` with the two functions**

```ts
import type { Prisma, PrismaClient } from "@lumio/db";
import { toPhotoDTO } from "@lumio/db";
import {
  DEFAULT_PHOTO_SORT,
  FieldType,
  parseMetadataSort,
  type PhotoDTO,
  type PhotoNeighbors,
  type PhotoSort,
  type PhotosPage,
  type PhotoStripItem,
} from "@lumio/shared";

/** Db surface the metadata-sort path needs. */
export type MetaDb = Pick<PrismaClient, "photo" | "photoMetadataValue" | "metadataField">;

/** A sort resolved against a catalog: a fixed ordering, or a validated Date field. */
export type ResolvedSort =
  | { kind: "standard"; sort?: PhotoSort }
  | { kind: "metadata"; fieldId: string; dir: "asc" | "desc" };

/**
 * Resolve a sort token against a catalog. A `meta:` token is validated against
 * the schema (field exists, enabled, type Date); anything invalid (missing,
 * disabled, wrong type, foreign catalog) degrades to `{ kind: "standard" }`,
 * i.e. the default ordering. Fixed sorts pass through without a query.
 */
export async function resolveSort(
  catalogId: string,
  sort: PhotoSort | undefined,
  db: MetaDb,
): Promise<ResolvedSort> {
  const meta = parseMetadataSort(sort);
  if (!meta) return { kind: "standard", sort };
  const field = await db.metadataField.findFirst({
    where: { id: meta.fieldId, catalogId, enabled: true, type: FieldType.Date },
    select: { id: true },
  });
  return field
    ? { kind: "metadata", fieldId: meta.fieldId, dir: meta.dir }
    : { kind: "standard", sort: DEFAULT_PHOTO_SORT };
}

interface SegSlice {
  skip: number;
  take: number;
}

export interface MetadataSlice {
  seg1: SegSlice | null;
  seg2: SegSlice | null;
}

/**
 * Slice an offset/limit window across the concatenation [valued ++ unvalued],
 * where `seg1count` is the number of in-scope photos that have a value. seg1 is
 * the valued segment (ordered by value), seg2 the unvalued tail (ordered by id).
 * Pure — the only non-trivial pagination arithmetic, tested in isolation.
 */
export function metadataPageSlice(offset: number, limit: number, seg1count: number): MetadataSlice {
  const seg1: SegSlice | null =
    offset < seg1count ? { skip: offset, take: Math.min(limit, seg1count - offset) } : null;
  const taken1 = seg1?.take ?? 0;
  const seg2take = limit - taken1;
  const seg2: SegSlice | null =
    seg2take > 0 ? { skip: Math.max(0, offset - seg1count), take: seg2take } : null;
  return { seg1, seg2 };
}
```

(The other exports referenced by later tasks — `listPhotosByMetadata`, `metadataSortIndexOf`, `metadataNeighbors` — are added in Tasks 4 and 5. The imports above already cover what they need.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/web test -- metadata-sort`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/metadata-sort.ts apps/web/src/lib/server/metadata-sort.test.ts
git commit -m "feat(web): resolveSort + metadataPageSlice for metadata-field sort"
```

---

## Task 4: Server — `listPhotosByMetadata` (the grid reader)

**Files:**
- Modify: `apps/web/src/lib/server/metadata-sort.ts`
- Test: `apps/web/src/lib/server/metadata-sort.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `apps/web/src/lib/server/metadata-sort.test.ts`:

```ts
import { listPhotosByMetadata } from "./metadata-sort.js";

function photoRow(id: string) {
  return {
    id,
    path: `${id}.jpg`,
    source: "filesystem" as const,
    takenAt: new Date("2024-01-01T00:00:00.000Z"),
    sortDate: new Date("2024-01-01T00:00:00.000Z"),
    fileModifiedAt: new Date("2024-01-01T00:00:00.000Z"),
    fileCreatedAt: new Date("2024-01-01T00:00:00.000Z"),
    width: 10,
    height: 10,
    hash: null,
    exif: {},
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
  };
}

describe("listPhotosByMetadata", () => {
  it("concatenates valued (ordered by value) then unvalued (ordered by id), total = full count", async () => {
    const valuedOrderBy: unknown[] = [];
    const unvaluedWhere: unknown[] = [];
    const db = {
      photo: {
        count: async () => 4,
        findMany: async (args: { where: unknown; orderBy: unknown }) => {
          unvaluedWhere.push(args.where);
          // unvalued segment, ordered by id asc
          return [photoRow("c"), photoRow("d")];
        },
      },
      photoMetadataValue: {
        count: async () => 2, // seg1count
        findMany: async (args: { orderBy: unknown }) => {
          valuedOrderBy.push(args.orderBy);
          return [{ photo: photoRow("a") }, { photo: photoRow("b") }];
        },
      },
    };
    const page = await listPhotosByMetadata(
      { catalogId: "cat1" },
      { fieldId: "d1", dir: "asc" },
      { limit: 50, offset: 0 },
      db as never,
    );
    expect(page.items.map((p) => p.id)).toEqual(["a", "b", "c", "d"]);
    expect(page.total).toBe(4);
    expect(valuedOrderBy[0]).toEqual([{ value: "asc" }, { photoId: "asc" }]);
    expect(unvaluedWhere[0]).toMatchObject({ catalogId: "cat1", metadataValues: { none: { fieldId: "d1" } } });
  });

  it("reads only segment 2 when the offset is past all valued photos", async () => {
    const db = {
      photo: {
        count: async () => 5,
        findMany: async () => [photoRow("e")],
      },
      photoMetadataValue: {
        count: async () => 2,
        findMany: vi.fn(async () => []),
      },
    };
    const page = await listPhotosByMetadata(
      { catalogId: "cat1" },
      { fieldId: "d1", dir: "desc" },
      { limit: 2, offset: 4 },
      db as never,
    );
    expect(page.items.map((p) => p.id)).toEqual(["e"]);
    expect(db.photoMetadataValue.findMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/web test -- metadata-sort`
Expected: FAIL — `listPhotosByMetadata` is not exported.

- [ ] **Step 3: Add `listPhotosByMetadata` to `apps/web/src/lib/server/metadata-sort.ts`**

```ts
/**
 * One page of photos ordered by a Date metadata field, nulls-last. Queries from
 * the value side so each scope's existing `full` where reuses verbatim under
 * `photo:`; the unvalued tail is a separate `metadataValues: { none }` query.
 * `full` must already include catalogId + the live-photo filter + the scope where.
 */
export async function listPhotosByMetadata(
  full: Prisma.PhotoWhereInput,
  meta: { fieldId: string; dir: "asc" | "desc" },
  page: { limit: number; offset: number },
  db: MetaDb,
): Promise<PhotosPage> {
  const [total, seg1count] = await Promise.all([
    db.photo.count({ where: full }),
    db.photoMetadataValue.count({ where: { fieldId: meta.fieldId, photo: full } }),
  ]);
  const slice = metadataPageSlice(page.offset, page.limit, seg1count);
  const items: PhotoDTO[] = [];
  if (slice.seg1) {
    const rows = await db.photoMetadataValue.findMany({
      where: { fieldId: meta.fieldId, photo: full },
      orderBy: [{ value: meta.dir }, { photoId: meta.dir }],
      skip: slice.seg1.skip,
      take: slice.seg1.take,
      include: { photo: true },
    });
    items.push(...rows.map((r) => toPhotoDTO(r.photo)));
  }
  if (slice.seg2) {
    const rows = await db.photo.findMany({
      where: { ...full, metadataValues: { none: { fieldId: meta.fieldId } } },
      orderBy: [{ id: meta.dir }],
      skip: slice.seg2.skip,
      take: slice.seg2.take,
    });
    items.push(...rows.map(toPhotoDTO));
  }
  return { items, total };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/web test -- metadata-sort`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/metadata-sort.ts apps/web/src/lib/server/metadata-sort.test.ts
git commit -m "feat(web): listPhotosByMetadata grid reader (nulls-last, two-segment)"
```

---

## Task 5: Server — `metadataSortIndexOf` + `metadataNeighbors` (detail strip)

**Files:**
- Modify: `apps/web/src/lib/server/metadata-sort.ts`
- Test: `apps/web/src/lib/server/metadata-sort.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `apps/web/src/lib/server/metadata-sort.test.ts`:

```ts
import { metadataNeighbors, metadataSortIndexOf } from "./metadata-sort.js";

describe("metadataSortIndexOf", () => {
  it("ranks a valued photo by counting valued rows before it (asc)", async () => {
    const db = {
      photoMetadataValue: {
        findUnique: async () => ({ value: "2024-05-01" }),
        count: async (args: { where: { OR?: unknown } }) => {
          expect(args.where.OR).toEqual([
            { value: { lt: "2024-05-01" } },
            { value: "2024-05-01", photoId: { lt: "p5" } },
          ]);
          return 3;
        },
      },
    };
    const i = await metadataSortIndexOf({ id: "p5", path: "p5.jpg" }, { catalogId: "c" }, { fieldId: "d1", dir: "asc" }, db as never);
    expect(i).toBe(3);
  });

  it("ranks an unvalued photo after all valued ones (seg1count + id rank)", async () => {
    const db = {
      photoMetadataValue: {
        findUnique: async () => null,
        count: async () => 6, // seg1count
      },
      photo: {
        count: async (args: { where: { id?: unknown } }) => {
          expect(args.where.id).toEqual({ lt: "p9" });
          return 2;
        },
      },
    };
    const i = await metadataSortIndexOf({ id: "p9", path: "p9.jpg" }, { catalogId: "c" }, { fieldId: "d1", dir: "asc" }, db as never);
    expect(i).toBe(8);
  });
});

describe("metadataNeighbors", () => {
  it("derives prev/next/strip from the window around the current index", async () => {
    // current "b" sits at global index 4 in a fully-valued run of >=6 photos.
    // window 1 -> from = 3, limit = (4 + 1) - 3 + 1 = 3, so the block is the 3
    // valued rows at skip 3 (seg1 only, since seg1count 6 > from+limit).
    const window = [
      { id: "a", path: "a.jpg" },
      { id: "b", path: "b.jpg" }, // current, pos = index(4) - from(3) = 1
      { id: "c", path: "c.jpg" },
    ];
    const db = {
      photoMetadataValue: {
        findUnique: async () => ({ value: "v" }), // current is valued
        // OR present -> "rows before current" = index 4; no OR -> seg1count = 6
        count: async (args: { where: { OR?: unknown } }) => (args.where.OR ? 4 : 6),
        findMany: async () => window.map((p) => ({ photo: p })),
      },
      photo: { findMany: async () => [] }, // seg2 not reached (window is all valued)
    };
    const n = await metadataNeighbors(
      { catalogId: "c" },
      { fieldId: "d1", dir: "asc" },
      { id: "b", path: "b.jpg" },
      1,
      db as never,
    );
    expect(n.strip.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(n.prevId).toBe("a");
    expect(n.nextId).toBe("c");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/web test -- metadata-sort`
Expected: FAIL — `metadataSortIndexOf` / `metadataNeighbors` not exported.

- [ ] **Step 3: Add both functions to `apps/web/src/lib/server/metadata-sort.ts`**

```ts
/** Cursor comparator for "strictly before" in the sort direction. */
function beforeOp(dir: "asc" | "desc"): "lt" | "gt" {
  return dir === "asc" ? "lt" : "gt";
}

/**
 * The current photo's global position in the metadata-sorted sequence. Valued
 * photos rank by (value, photoId) before-cursor; an unvalued photo ranks after
 * every valued photo (seg1count) plus the unvalued rows before it by id.
 */
export async function metadataSortIndexOf(
  current: PhotoStripItem,
  full: Prisma.PhotoWhereInput,
  meta: { fieldId: string; dir: "asc" | "desc" },
  db: MetaDb,
): Promise<number> {
  const op = beforeOp(meta.dir);
  const cur = await db.photoMetadataValue.findUnique({
    where: { photoId_fieldId: { photoId: current.id, fieldId: meta.fieldId } },
    select: { value: true },
  });
  if (cur) {
    return db.photoMetadataValue.count({
      where: {
        fieldId: meta.fieldId,
        photo: full,
        OR: [{ value: { [op]: cur.value } }, { value: cur.value, photoId: { [op]: current.id } }],
      },
    });
  }
  const seg1count = await db.photoMetadataValue.count({ where: { fieldId: meta.fieldId, photo: full } });
  const before = await db.photo.count({
    where: { ...full, metadataValues: { none: { fieldId: meta.fieldId } }, id: { [op]: current.id } },
  });
  return seg1count + before;
}

/** Read a contiguous {id,path} window [offset, offset+limit) across both segments. */
async function readWindow(
  full: Prisma.PhotoWhereInput,
  meta: { fieldId: string; dir: "asc" | "desc" },
  offset: number,
  limit: number,
  db: MetaDb,
): Promise<PhotoStripItem[]> {
  const seg1count = await db.photoMetadataValue.count({ where: { fieldId: meta.fieldId, photo: full } });
  const slice = metadataPageSlice(offset, limit, seg1count);
  const out: PhotoStripItem[] = [];
  if (slice.seg1) {
    const rows = await db.photoMetadataValue.findMany({
      where: { fieldId: meta.fieldId, photo: full },
      orderBy: [{ value: meta.dir }, { photoId: meta.dir }],
      skip: slice.seg1.skip,
      take: slice.seg1.take,
      select: { photo: { select: { id: true, path: true } } },
    });
    out.push(...rows.map((r) => r.photo));
  }
  if (slice.seg2) {
    const rows = await db.photo.findMany({
      where: { ...full, metadataValues: { none: { fieldId: meta.fieldId } } },
      orderBy: [{ id: meta.dir }],
      skip: slice.seg2.skip,
      take: slice.seg2.take,
      select: { id: true, path: true },
    });
    out.push(...rows);
  }
  return out;
}

/**
 * Prev/next + film-strip window for a metadata-sorted scope. Reuses the same
 * two-segment reader as the grid: find the current photo's global index, then
 * read the `window`-sized block around it and split into prev/current/next.
 */
export async function metadataNeighbors(
  full: Prisma.PhotoWhereInput,
  meta: { fieldId: string; dir: "asc" | "desc" },
  current: PhotoStripItem,
  window: number,
  db: MetaDb,
): Promise<PhotoNeighbors> {
  const index = await metadataSortIndexOf(current, full, meta, db);
  const from = Math.max(0, index - window);
  const limit = index + window - from + 1;
  const block = await readWindow(full, meta, from, limit, db);
  const pos = index - from;
  return {
    prevId: block[pos - 1]?.id ?? null,
    nextId: block[pos + 1]?.id ?? null,
    strip: block.length ? block : [current],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/web test -- metadata-sort`
Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/metadata-sort.ts apps/web/src/lib/server/metadata-sort.test.ts
git commit -m "feat(web): metadataNeighbors detail-strip window for metadata sort"
```

---

## Task 6: Wire the two server choke points

**Files:**
- Modify: `apps/web/src/lib/server/photos-service.ts` (`listPhotosForWhere` ~36-53, `getNeighborsForWhere` ~175-207, `Db`/`NeighborDb` types ~15-17)
- Test: `apps/web/src/lib/server/photos-service.test.ts`

- [ ] **Step 1: Add failing routing tests**

Append to `apps/web/src/lib/server/photos-service.test.ts`:

```ts
describe("listPhotosForWhere — metadata sort routing", () => {
  it("routes a valid meta sort to the value-side reader", async () => {
    const db = {
      metadataField: { findFirst: async () => ({ id: "d1" }) },
      photo: {
        count: async () => 1,
        findMany: async () => [], // unvalued segment
      },
      photoMetadataValue: {
        count: async () => 1,
        findMany: async () => [{ photo: row("a") }],
      },
    };
    const page = await listPhotosForWhere(CAT, {}, { limit: 50, offset: 0, sort: "meta:d1:asc" }, db as never);
    expect(page.items.map((p) => p.id)).toEqual(["a"]);
  });

  it("falls back to the standard reader when the meta field is invalid", async () => {
    const orderBys: unknown[] = [];
    const db = {
      metadataField: { findFirst: async () => null },
      photo: {
        count: async () => 1,
        findMany: async (args: { orderBy: unknown }) => {
          orderBys.push(args.orderBy);
          return [row("a")];
        },
      },
    };
    const page = await listPhotosForWhere(CAT, {}, { limit: 50, offset: 0, sort: "meta:zzz:asc" }, db as never);
    expect(page.items.map((p) => p.id)).toEqual(["a"]);
    // invalid meta -> default ordering
    expect(orderBys[0]).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
  });
});

describe("getNeighborsForWhere — metadata sort routing", () => {
  it("takes the metadata window branch for a valid Date field (degrades to [current] when the window is empty)", async () => {
    // A valid meta sort routes into metadataNeighbors. With seg1count 0 and no
    // unvalued rows, the window is empty and the strip degrades to [current] —
    // proving the metadata branch ran (the keyset path would have used cursors).
    const db = {
      metadataField: { findFirst: async () => ({ id: "d1" }) },
      photoMetadataValue: {
        findUnique: async () => ({ value: "v" }), // current is valued
        count: async () => 0, // seg1count and "before" both 0 -> index 0
      },
      photo: { findMany: async () => [] }, // no unvalued rows in the window
    };
    const n = await getNeighborsForWhere({ id: "p0", path: "p0.jpg" }, { catalogId: CAT }, "meta:d1:asc", 5, db as never);
    expect(n.strip.map((s) => s.id)).toEqual(["p0"]);
    expect(n.prevId).toBeNull();
    expect(n.nextId).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/web test -- photos-service`
Expected: FAIL — the metadata routing isn't wired (current code calls `db.photo.findMany`/keyset for all sorts; the meta tests hit unimplemented branches / call shapes that don't exist yet).

- [ ] **Step 3: Edit `apps/web/src/lib/server/photos-service.ts`**

3a. Widen the db types and add imports. At the top, add to the existing imports:

```ts
import { listPhotosByMetadata, metadataNeighbors, resolveSort } from "@/lib/server/metadata-sort";
```

Change the `Db` and `NeighborDb` aliases (~lines 15-17) to:

```ts
type Db = Pick<PrismaClient, "photo" | "photoMetadataValue" | "metadataField">;

type NeighborDb = Pick<PrismaClient, "photo" | "album" | "photoMetadataValue" | "metadataField">;
```

3b. Replace the body of `listPhotosForWhere` (the `full` build + `Promise.all` block) with:

```ts
  const full: Prisma.PhotoWhereInput = { catalogId, ...LIVE_PHOTO, ...where };
  const resolved = await resolveSort(catalogId, params.sort, db);
  if (resolved.kind === "metadata") {
    return listPhotosByMetadata(full, resolved, { limit: params.limit, offset: params.offset }, db);
  }
  const [rows, total] = await Promise.all([
    db.photo.findMany({
      where: full,
      skip: params.offset,
      take: params.limit,
      orderBy: photoOrderBy(resolved.sort),
    }),
    db.photo.count({ where: full }),
  ]);
  return { items: rows.map(toPhotoDTO), total };
```

3c. At the start of `getNeighborsForWhere`, before the `const select` line, insert the resolve + metadata branch:

```ts
  const catalogId = typeof where.catalogId === "string" ? where.catalogId : null;
  const resolved = catalogId
    ? await resolveSort(catalogId, sort, db)
    : ({ kind: "standard", sort } as const);
  if (resolved.kind === "metadata") {
    return metadataNeighbors({ ...where, ...LIVE_PHOTO }, resolved, current, window, db);
  }
  const select = { id: true, path: true } as const;
  const orderBy = photoOrderBy(resolved.sort);
```

(Delete the old `const select` / `const orderBy = photoOrderBy(sort)` lines that this replaces; the `before`/`after` `Promise.all` below stays unchanged.)

- [ ] **Step 4: Run the metadata routing tests**

Run: `pnpm --filter @lumio/web test -- photos-service`
Expected: PASS — including the existing standard-sort tests (they pass standard sorts, so `resolveSort` short-circuits without touching `metadataField`).

- [ ] **Step 5: Typecheck web**

Run: `pnpm --filter @lumio/web exec tsc --noEmit` (or the repo's typecheck script)
Expected: no errors. (If `getPhotoNeighbors`/`getNeighborsForWhere` callers complain about db types, confirm real callers pass `prisma`; tests use `db as never`.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/server/photos-service.ts apps/web/src/lib/server/photos-service.test.ts
git commit -m "feat(web): route metadata-field sort through listPhotosForWhere + neighbors"
```

---

## Task 7: Extend `GridSortMenu` with date fields

**Files:**
- Modify: `apps/web/src/components/grid-sort-menu.tsx`

- [ ] **Step 1: Edit the menu**

Replace the file with (changes: import `isPhotoSort`/`metadataSort` and `Fragment` + `DateSortField`; add `dateFields` prop; widen the guard; render a group per date field):

```tsx
"use client";

import { Fragment } from "react";
import { ArrowDownUp } from "lucide-react";
import { isPhotoSort, metadataSort, type PhotoSort } from "@lumio/shared";
import type { DateSortField } from "@/lib/grid-sort";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Header control to pick the photo sort. Mirrors GridViewMenu: an icon-button
 * trigger opening a radio group, grouped into Date taken / Date imported / File
 * created, plus one group per enabled custom Date field, each with newest- and
 * oldest-first. The active value is checked.
 */
export function GridSortMenu({
  sort,
  onSortChange,
  dateFields = [],
}: {
  sort: PhotoSort;
  onSortChange: (sort: PhotoSort) => void;
  dateFields?: DateSortField[];
}) {
  return (
    <Tooltip>
      <DropdownMenu>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon-sm" aria-label="Sort">
              <ArrowDownUp />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuRadioGroup
            value={sort}
            onValueChange={(value) => {
              if (isPhotoSort(value)) onSortChange(value);
            }}
          >
            <DropdownMenuLabel>Date taken</DropdownMenuLabel>
            <DropdownMenuRadioItem value="taken-desc">Newest first</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="taken-asc">Oldest first</DropdownMenuRadioItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Date imported</DropdownMenuLabel>
            <DropdownMenuRadioItem value="imported-desc">Newest first</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="imported-asc">Oldest first</DropdownMenuRadioItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>File created</DropdownMenuLabel>
            <DropdownMenuRadioItem value="file-created-desc">Newest first</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="file-created-asc">Oldest first</DropdownMenuRadioItem>
            {dateFields.map((f) => (
              <Fragment key={f.id}>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{f.label}</DropdownMenuLabel>
                <DropdownMenuRadioItem value={metadataSort(f.id, "desc")}>Newest first</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value={metadataSort(f.id, "asc")}>Oldest first</DropdownMenuRadioItem>
              </Fragment>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <TooltipContent>Sort</TooltipContent>
    </Tooltip>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: no errors. (The two current callers still compile — `dateFields` is optional; Task 8 passes it.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/grid-sort-menu.tsx
git commit -m "feat(web): GridSortMenu lists enabled Date fields as sort options"
```

---

## Task 8: Wire the two view hosts

**Files:**
- Modify: `apps/web/src/components/photo-library/photo-library-view.tsx`
- Modify: `apps/web/src/app/(app)/c/[catalog]/search/search-view.tsx`

- [ ] **Step 1: Edit `photo-library-view.tsx`**

1a. Add imports (near the other `@/lib` imports):

```ts
import { useCatalog } from "@/components/providers/catalog-context";
import { useCatalogMetadataSchema } from "@/features/lightbox/use-metadata-schema";
import { dateSortFields, effectiveGridSort } from "@/lib/grid-sort";
```

1b. In the component body, replace the `const { sort, setSort } = useGridSort();` line with:

```ts
  const { slug } = useCatalog();
  const schema = useCatalogMetadataSchema(slug);
  const dateFields = schema ? dateSortFields(schema) : undefined;
  const { sort: storedSort, setSort } = useGridSort();
  const sort = effectiveGridSort(storedSort, dateFields);
```

1c. Pass the fields into the menu — change the `<GridSortMenu .../>` line to:

```tsx
                <GridSortMenu sort={sort} onSortChange={setSort} dateFields={dateFields ?? []} />
```

(Everything else already reads `sort` — `collection({ sort, month })`, the provider `key`, tile hrefs — so the effective sort threads through unchanged.)

- [ ] **Step 2: Edit `search-view.tsx`**

2a. Add imports (near the other `@/lib` imports):

```ts
import { useCatalogMetadataSchema } from "@/features/lightbox/use-metadata-schema";
import { dateSortFields, effectiveGridSort } from "@/lib/grid-sort";
```

(`useCatalog` is already imported here.)

2b. Replace the `const { sort, setSort } = useGridSort();` line with:

```ts
  const schema = useCatalogMetadataSchema(slug);
  const dateFields = schema ? dateSortFields(schema) : undefined;
  const { sort: storedSort, setSort } = useGridSort();
  const sort = effectiveGridSort(storedSort, dateFields);
```

(`const { slug } = useCatalog();` already runs above this line.)

2c. Change the `<GridSortMenu .../>` render to:

```tsx
              <GridSortMenu sort={sort} onSortChange={setSort} dateFields={dateFields ?? []} />
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm --filter @lumio/web exec tsc --noEmit && pnpm --filter @lumio/web lint`
Expected: no errors. (Watch the React-Compiler lint rules: no new refs-in-effect, `"use client"` stays line 1.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/photo-library/photo-library-view.tsx "apps/web/src/app/(app)/c/[catalog]/search/search-view.tsx"
git commit -m "feat(web): offer Date-field sorts in library/album/folder/search grids"
```

---

## Task 9: Verify the ISO date-write invariant

The text sort is only chronological if Date values are ISO `YYYY-MM-DD`. The picker writes ISO; this task verifies nothing else writes a Date field as non-ISO text.

**Files:**
- Inspect only (modify a writer only if a violation is found).

- [ ] **Step 1: List every writer of `PhotoMetadataValue.value`**

Run:
```bash
grep -rn "upsertPhotoMetadataValue\|photoMetadataValue.create\|photoMetadataValue.update" packages apps
```
Expected: the single writer `upsertPhotoMetadataValue` in `packages/db/src/metadata.ts`, plus its callers (the metadata photo route, the selection route, and any preset/NLP apply path).

- [ ] **Step 2: Check each caller's input for Date fields**

For each caller, confirm the value supplied for a `FieldType.Date` field originates from the ISO date picker (`DateField` in `apps/web/src/components/metadata/metadata-value-input.tsx`, which writes `format(next, "yyyy-MM-dd")`) and not from free-text / NLP extraction. Inspect:
```bash
grep -rn "FieldType.Date\|metadata/photo\|metadata/selection\|applyMetadataPreset" apps/web/src/app/api/c/\[catalog\]/metadata packages/db/src/metadata.ts
```

- [ ] **Step 3: Decide and record**

- If **all** Date writes go through the picker (expected): no code change. Add a one-line code comment at the top of `upsertPhotoMetadataValue` noting the ISO invariant that the metadata-sort feature relies on:
  ```ts
  // Date-type values are written as ISO YYYY-MM-DD by the date picker; the grid's
  // metadata-Date sort relies on that (ISO text sorts chronologically).
  ```
- If a writer **can** persist a non-ISO Date value: normalize at that boundary — parse with `date-fns` and re-`format(..., "yyyy-MM-dd")`, dropping the write if unparseable — and add a unit test for the normalizer. (Only do this if Step 2 finds a real violation.)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs(db): note ISO date invariant relied on by metadata-Date sort"
```

(If Step 3 required a normalizer, include its file + test in this commit and adjust the message.)

---

## Task 10: Full verification + browser smoke test

**Files:** none (verification only).

- [ ] **Step 1: Run the full test + typecheck + lint**

Run:
```bash
pnpm --filter @lumio/shared test && pnpm --filter @lumio/web test && pnpm --filter @lumio/web exec tsc --noEmit && pnpm --filter @lumio/web lint
```
Expected: all green.

- [ ] **Step 2: Browser smoke (per the dev-workflow: verify UI in the browser)**

Start the app, open a catalog that has at least one enabled custom **Date** field with values on some photos (and some photos without a value). Verify:

1. The sort dropdown shows the Date field with "Newest first" / "Oldest first" below "File created".
2. Selecting "Oldest first" reorders the grid ascending by the field's date; photos **without** a value appear **last**.
3. "Newest first" reverses the valued photos; unvalued photos still appear last.
4. Open a photo from the sorted grid → the ← → arrows and filmstrip walk the **same** order.
5. Switch to a catalog **without** that field (or one with no Date fields): the menu shows only the fixed sorts, and the grid falls back to the default order (no error).
6. Repeat the sort in an **Album**, a **Smart album**, and **Search** — ordering holds in each.

- [ ] **Step 3: Final commit (if any verification fix was needed)**

```bash
git add -A
git commit -m "test: verify metadata-Date sort end-to-end"
```

---

## Notes for the worker

- **Do not** change `packages/db/prisma/schema.prisma` — there is no migration in this plan.
- The `meta:` sort string is a `PhotoSort`, so it threads through the existing URL param, localStorage, `key={sort}` remount, tile hrefs, and `detail-scope.ts` (`coercePhotoSort` now accepts it) with no further changes.
- Keep functions focused: the value-side reader, the index, and the window all share the pure `metadataPageSlice`. Do not duplicate the slice arithmetic.
- Existing `photos-service.test.ts` cases use fake dbs without `metadataField`/`photoMetadataValue`; they keep passing because `resolveSort` short-circuits on fixed sorts before touching those models.
