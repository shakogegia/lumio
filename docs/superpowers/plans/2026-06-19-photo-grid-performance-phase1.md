# Photo Grid Performance — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the photo grid scroll smoothly at 5k–50k photos — a full-height scrollbar from first paint, compositor-painted skeleton beneath every cell, read-ahead prefetch, bounded memory — and stop charging a DB session lookup per thumbnail.

**Architecture:** Switch the four list services from keyset cursors to `offset`/`limit` + a `total` count. The client keeps a sparse `Map<pageIndex, items>` store (pure, unit-tested) sized to `total`, fetches whichever pages cover the visible range + prefetch, evicts least-recently-used pages, and paints a tiled-SVG skeleton on the full-height container so unloaded cells are never blank. Enable Better Auth cookie cache so image routes don't hit Postgres per request.

**Tech Stack:** Next.js (self-hosted Node), `@tanstack/react-virtual` `useWindowVirtualizer`, Prisma/Postgres, Zod, Vitest (hand-rolled fake DBs; UI verified in-browser), Better Auth.

**Cross-file note:** Task 2 changes the shared `PhotosPage` shape, which the old `use-photo-pages.ts` references. The web app's full typecheck goes green again at the end of Task 7 (the hook rewrite). Tasks 3–6 are each independently green under Vitest (service test files compile in isolation).

---

## File Structure

- `packages/shared/src/api.ts` — `PhotosPage` → `{ items, total }`; `cursor` → `offset` in `photosQuerySchema` + `searchQuerySchema`.
- `packages/shared/src/api.test.ts` *(new)* — schema offset defaults/coercion.
- `apps/web/src/lib/grid-layout.ts` — add `PHOTO_PAGE_SIZE` constant.
- `apps/web/src/lib/photos-service.ts` — `listPhotos` offset + total.
- `apps/web/src/lib/photos-service.test.ts` — adapt `listPhotos` tests cursor→offset.
- `apps/web/src/lib/albums-service.ts` — `listAlbumPhotos` offset + total.
- `apps/web/src/lib/search-service.ts` — `searchPhotos` offset + total.
- `apps/web/src/lib/trash-service.ts` — `listTrash` offset + total.
- `apps/web/src/lib/list-pagination.test.ts` *(new)* — album/search/trash offset+total.
- `apps/web/src/components/photo-grid/photo-page-store.ts` *(new)* — pure sparse page store.
- `apps/web/src/components/photo-grid/photo-page-store.test.ts` *(new)* — store unit tests.
- `apps/web/src/components/photo-grid/use-photo-pages.ts` — rewrite to offset + store.
- `apps/web/src/components/photo-grid/photo-grid.tsx` — full-count virtualizer, tiled skeleton bg, range-driven prefetch, render loaded cells + spacers.
- `apps/web/src/components/photo-grid/photo-thumb.tsx` — `decoding="async"`.
- `apps/web/src/lib/auth.ts` — enable `session.cookieCache`.

Routes (`/api/photos`, `/api/albums/[id]/photos`, `/api/search`, `/api/trash`) pass `parsed.data` straight to services, so the schema change flows through with **no route edits**.

---

### Task 1: Pure sparse page store

**Files:**
- Create: `apps/web/src/components/photo-grid/photo-page-store.ts`
- Test: `apps/web/src/components/photo-grid/photo-page-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/components/photo-grid/photo-page-store.test.ts
import { describe, expect, it } from "vitest";
import {
  createPageStore,
  loadedIds,
  pageIndicesForRange,
  patchPages,
  photoAt,
  removeIds,
  setPage,
} from "./photo-page-store";

type P = { id: string; label?: string };
const items = (base: number, n: number): P[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${base + i}` }));

describe("pageIndicesForRange", () => {
  it("covers every page intersecting the span", () => {
    expect(pageIndicesForRange(0, 0, 100)).toEqual([0]);
    expect(pageIndicesForRange(90, 110, 100)).toEqual([0, 1]);
    expect(pageIndicesForRange(250, 250, 100)).toEqual([2]);
    expect(pageIndicesForRange(-5, 5, 100)).toEqual([0]);
  });
});

describe("setPage + photoAt", () => {
  it("stores a page, exposes items by absolute index, and tracks total", () => {
    let s = createPageStore<P>(100, 10);
    s = setPage(s, 0, items(0, 100), 530);
    s = setPage(s, 2, items(200, 100), 530);
    expect(s.total).toBe(530);
    expect(photoAt(s, 0)?.id).toBe("p0");
    expect(photoAt(s, 99)?.id).toBe("p99");
    expect(photoAt(s, 150)).toBeUndefined(); // page 1 not loaded
    expect(photoAt(s, 200)?.id).toBe("p200");
  });

  it("evicts the least-recently-used page past the cap", () => {
    let s = createPageStore<P>(100, 2);
    s = setPage(s, 0, items(0, 100), 1000); // lru: [0]
    s = setPage(s, 1, items(100, 100), 1000); // lru: [0,1]
    s = setPage(s, 2, items(200, 100), 1000); // over cap → evict 0; lru: [1,2]
    expect(s.pages.has(0)).toBe(false);
    expect(s.pages.has(1)).toBe(true);
    expect(s.pages.has(2)).toBe(true);
  });
});

describe("loadedIds", () => {
  it("returns a sparse array with holes for unloaded indices", () => {
    let s = createPageStore<P>(100, 10);
    s = setPage(s, 0, items(0, 100), 300);
    s = setPage(s, 2, items(200, 100), 300);
    const ids = loadedIds(s);
    expect(ids[0]).toBe("p0");
    expect(ids[99]).toBe("p99");
    expect(ids[150]).toBeUndefined();
    expect(ids[200]).toBe("p200");
  });
});

describe("patchPages", () => {
  it("shallow-merges patch into loaded items whose id matches", () => {
    let s = createPageStore<P>(100, 10);
    s = setPage(s, 0, items(0, 3), 3);
    s = patchPages(s, new Set(["p1"]), { label: "x" });
    expect(photoAt(s, 0)?.label).toBeUndefined();
    expect(photoAt(s, 1)?.label).toBe("x");
  });
});

describe("removeIds", () => {
  it("decrements total and evicts pages at/after the lowest affected page", () => {
    let s = createPageStore<P>(100, 10);
    s = setPage(s, 0, items(0, 100), 300);
    s = setPage(s, 1, items(100, 100), 300);
    s = setPage(s, 2, items(200, 100), 300);
    // remove one id living in page 1 → page 0 stays, pages 1 & 2 evicted (offsets shift)
    s = removeIds(s, new Set(["p150"]));
    expect(s.total).toBe(299);
    expect(s.pages.has(0)).toBe(true);
    expect(s.pages.has(1)).toBe(false);
    expect(s.pages.has(2)).toBe(false);
  });

  it("only decrements total when no loaded page is affected", () => {
    let s = createPageStore<P>(100, 10);
    s = setPage(s, 0, items(0, 100), 300);
    s = removeIds(s, new Set(["p999"])); // not loaded
    expect(s.total).toBe(299);
    expect(s.pages.has(0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/web exec vitest run src/components/photo-grid/photo-page-store.test.ts`
Expected: FAIL — cannot find module `./photo-page-store`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/src/components/photo-grid/photo-page-store.ts

/**
 * Sparse, page-indexed photo store for the virtualized grid. Pure and
 * React-free so the page math, eviction, and optimistic mutations are unit
 * tested directly. The hook (`use-photo-pages.ts`) holds one of these in state.
 */
export interface PageStore<T> {
  pageSize: number;
  maxPages: number;
  total: number | null;
  pages: Map<number, T[]>;
  /** Page indices ordered least-recently-used first. */
  lru: number[];
}

export function createPageStore<T>(pageSize: number, maxPages: number): PageStore<T> {
  return { pageSize, maxPages, total: null, pages: new Map(), lru: [] };
}

/** Inclusive page indices covering the absolute-index span (clamped to >= 0). */
export function pageIndicesForRange(
  startIndex: number,
  endIndex: number,
  pageSize: number,
): number[] {
  const lo = Math.max(0, Math.floor(startIndex / pageSize));
  const hi = Math.max(0, Math.floor(endIndex / pageSize));
  const out: number[] = [];
  for (let p = lo; p <= hi; p++) out.push(p);
  return out;
}

export function photoAt<T>(store: PageStore<T>, index: number): T | undefined {
  if (index < 0) return undefined;
  return store.pages.get(Math.floor(index / store.pageSize))?.[index % store.pageSize];
}

function touch(lru: number[], pageIndex: number): number[] {
  const next = lru.filter((p) => p !== pageIndex);
  next.push(pageIndex);
  return next;
}

/** Store a fetched page, refresh total, and evict LRU pages past the cap. */
export function setPage<T>(
  store: PageStore<T>,
  pageIndex: number,
  items: T[],
  total: number,
): PageStore<T> {
  const pages = new Map(store.pages);
  pages.set(pageIndex, items);
  let lru = touch(store.lru, pageIndex);
  while (lru.length > store.maxPages) {
    const evict = lru[0]!;
    lru = lru.slice(1);
    pages.delete(evict);
  }
  return { ...store, pages, lru, total };
}

/** Sparse array (holes for unloaded indices) of ids, for selection-range math. */
export function loadedIds<T extends { id: string }>(store: PageStore<T>): string[] {
  const ids: string[] = [];
  for (const [pageIndex, items] of store.pages) {
    const base = pageIndex * store.pageSize;
    items.forEach((it, i) => {
      ids[base + i] = it.id;
    });
  }
  return ids;
}

/** Optimistic patch: shallow-merge `patch` into loaded items whose id is in `ids`. */
export function patchPages<T extends { id: string }>(
  store: PageStore<T>,
  ids: Set<string>,
  patch: Partial<T>,
): PageStore<T> {
  const pages = new Map<number, T[]>();
  for (const [pageIndex, items] of store.pages) {
    pages.set(
      pageIndex,
      items.map((it) => (ids.has(it.id) ? { ...it, ...patch } : it)),
    );
  }
  return { ...store, pages };
}

/**
 * Optimistic remove (after a confirmed server delete): decrement total by the
 * number removed, and evict every loaded page at/after the lowest page holding a
 * removed id — those pages' offsets have shifted, so they refetch correctly on
 * re-scroll. Pages before it are untouched (nothing shifted them).
 */
export function removeIds<T extends { id: string }>(
  store: PageStore<T>,
  ids: Set<string>,
): PageStore<T> {
  let lowestAffected = Infinity;
  for (const [pageIndex, items] of store.pages) {
    if (items.some((it) => ids.has(it.id))) {
      lowestAffected = Math.min(lowestAffected, pageIndex);
    }
  }
  const pages = new Map<number, T[]>();
  let lru = store.lru;
  for (const [pageIndex, items] of store.pages) {
    if (pageIndex >= lowestAffected) {
      lru = lru.filter((p) => p !== pageIndex);
      continue;
    }
    pages.set(pageIndex, items);
  }
  const total = store.total === null ? null : Math.max(0, store.total - ids.size);
  return { ...store, pages, lru, total };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/web exec vitest run src/components/photo-grid/photo-page-store.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/photo-grid/photo-page-store.ts apps/web/src/components/photo-grid/photo-page-store.test.ts
git commit -m "feat(grid): pure sparse page store for virtualized photo grid"
```

---

### Task 2: Shared — PhotosPage `{items,total}` + `offset` query schemas

**Files:**
- Modify: `packages/shared/src/api.ts`
- Create: `packages/shared/src/api.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/api.test.ts
import { describe, expect, it } from "vitest";
import { photosQuerySchema, searchQuerySchema } from "./api.js";

describe("photosQuerySchema", () => {
  it("defaults offset to 0 and coerces it from a string", () => {
    expect(photosQuerySchema.parse({}).offset).toBe(0);
    expect(photosQuerySchema.parse({ offset: "200" }).offset).toBe(200);
  });
  it("rejects a negative offset", () => {
    expect(photosQuerySchema.safeParse({ offset: "-1" }).success).toBe(false);
  });
});

describe("searchQuerySchema", () => {
  it("defaults offset to 0 and coerces it", () => {
    expect(searchQuerySchema.parse({}).offset).toBe(0);
    expect(searchQuerySchema.parse({ offset: "50" }).offset).toBe(50);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/shared exec vitest run src/api.test.ts`
Expected: FAIL — `offset` is `undefined` (schema still has `cursor`).

- [ ] **Step 3: Edit the schemas and response type**

In `packages/shared/src/api.ts`, replace the `cursor` line in `photosQuerySchema`:

```ts
export const photosQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  sort: photoSortSchema.optional(),
});
```

Replace the `PhotosPage` interface:

```ts
/** Offset-paginated photo list response. `total` is the full match count. */
export interface PhotosPage {
  items: PhotoDTO[];
  total: number;
}
```

In `searchQuerySchema`, replace the `cursor` line with the same offset field:

```ts
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  sort: photoSortSchema.optional(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/shared exec vitest run src/api.test.ts`
Expected: PASS. (The web app's full typecheck is intentionally red until Task 7 — that's expected per the cross-file note.)

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/api.ts packages/shared/src/api.test.ts
git commit -m "feat(shared): offset pagination + total in PhotosPage"
```

---

### Task 3: `listPhotos` — offset + total

**Files:**
- Modify: `apps/web/src/lib/photos-service.ts` (the `listPhotos` function)
- Modify: `apps/web/src/lib/photos-service.test.ts` (the `fakeDb` helper + `describe("listPhotos")`)

- [ ] **Step 1: Update the test (new failing expectations)**

In `apps/web/src/lib/photos-service.test.ts`, replace the `fakeDb` helper:

```ts
function fakeDb(rows: ReturnType<typeof row>[]) {
  const calls: Array<{ skip?: number; take: number; orderBy?: unknown }> = [];
  return {
    calls,
    photo: {
      findMany: async (args: { skip?: number; take: number; orderBy?: unknown }) => {
        calls.push(args);
        const skip = args.skip ?? 0;
        return rows.slice(skip, skip + args.take);
      },
      count: async () => rows.length,
    },
  };
}
```

Replace the entire `describe("listPhotos", ...)` block with:

```ts
describe("listPhotos", () => {
  it("returns the page slice and the full total", async () => {
    const db = fakeDb([row("a"), row("b"), row("c")]);
    const page = await listPhotos({ limit: 2, offset: 0 }, db as never);
    expect(page.items.map((p) => p.id)).toEqual(["a", "b"]);
    expect(page.total).toBe(3);
    expect(db.calls[0]).toMatchObject({ skip: 0, take: 2 });
    expect(db.calls[0]?.orderBy).toEqual([{ sortDate: "desc" }, { id: "desc" }]);
  });

  it("applies offset for a later page", async () => {
    const db = fakeDb([row("a"), row("b"), row("c")]);
    const page = await listPhotos({ limit: 2, offset: 2 }, db as never);
    expect(page.items.map((p) => p.id)).toEqual(["c"]);
    expect(page.total).toBe(3);
    expect(db.calls[0]).toMatchObject({ skip: 2, take: 2 });
  });

  it("orders by createdAt desc when sort is imported-desc", async () => {
    const db = fakeDb([row("a")]);
    await listPhotos({ limit: 2, offset: 0, sort: "imported-desc" }, db as never);
    expect(db.calls[0]?.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/photos-service.test.ts -t listPhotos`
Expected: FAIL — `listPhotos` still returns `nextCursor`, no `count` on fake db is used.

- [ ] **Step 3: Rewrite `listPhotos`**

In `apps/web/src/lib/photos-service.ts`, replace the `listPhotos` function body:

```ts
export async function listPhotos(
  params: PhotosQuery,
  db: Db = prisma,
): Promise<PhotosPage> {
  const { limit, offset, sort } = params;
  const [rows, total] = await Promise.all([
    db.photo.findMany({ skip: offset, take: limit, orderBy: photoOrderBy(sort) }),
    db.photo.count(),
  ]);
  return { items: rows.map(toPhotoDTO), total };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/photos-service.test.ts -t listPhotos`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/photos-service.ts apps/web/src/lib/photos-service.test.ts
git commit -m "feat(photos): listPhotos offset pagination + total"
```

---

### Task 4: `listAlbumPhotos` — offset + total

**Files:**
- Modify: `apps/web/src/lib/albums-service.ts` (`listAlbumPhotos`)
- Create: `apps/web/src/lib/list-pagination.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/lib/list-pagination.test.ts
import { describe, expect, it } from "vitest";
import { listAlbumPhotos } from "./albums-service.js";

function row(id: string) {
  return {
    id,
    path: `${id}.jpg`,
    source: "filesystem" as const,
    takenAt: new Date("2024-01-01T00:00:00.000Z"),
    sortDate: new Date("2024-01-01T00:00:00.000Z"),
    width: 10,
    height: 10,
    hash: null,
    exif: {},
    colorLabel: null,
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
  };
}

function albumDb(rows: ReturnType<typeof row>[]) {
  const calls: Array<{ skip?: number; take: number; where?: unknown }> = [];
  return {
    calls,
    album: {
      findUnique: async () => ({
        id: "alb1",
        name: "A",
        isSmart: false,
        rules: null,
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
        updatedAt: new Date("2024-01-01T00:00:00.000Z"),
      }),
    },
    photo: {
      findMany: async (args: { skip?: number; take: number; where?: unknown }) => {
        calls.push(args);
        const skip = args.skip ?? 0;
        return rows.slice(skip, skip + args.take);
      },
      count: async () => rows.length,
    },
  };
}

describe("listAlbumPhotos", () => {
  it("returns the page slice + total and applies offset", async () => {
    const db = albumDb([row("a"), row("b"), row("c")]);
    const page = await listAlbumPhotos("alb1", { limit: 2, offset: 2 }, db as never);
    expect(page?.items.map((p) => p.id)).toEqual(["c"]);
    expect(page?.total).toBe(3);
    expect(db.calls[0]).toMatchObject({ skip: 2, take: 2 });
  });

  it("returns null when the album does not exist", async () => {
    const db = {
      album: { findUnique: async () => null },
      photo: { findMany: async () => [], count: async () => 0 },
    };
    const page = await listAlbumPhotos("ghost", { limit: 2, offset: 0 }, db as never);
    expect(page).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/list-pagination.test.ts -t listAlbumPhotos`
Expected: FAIL — `total` undefined (function still returns `nextCursor`).

- [ ] **Step 3: Rewrite `listAlbumPhotos`**

In `apps/web/src/lib/albums-service.ts`, replace the function body:

```ts
export async function listAlbumPhotos(
  id: string,
  params: PhotosQuery,
  db: Db = prisma,
): Promise<PhotosPage | null> {
  const where = await albumPhotoWhere(id, db);
  if (where === null) return null;
  const { limit, offset, sort } = params;
  const [rows, total] = await Promise.all([
    db.photo.findMany({ where, skip: offset, take: limit, orderBy: photoOrderBy(sort) }),
    db.photo.count({ where }),
  ]);
  return { items: rows.map(toPhotoDTO), total };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/list-pagination.test.ts -t listAlbumPhotos`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/albums-service.ts apps/web/src/lib/list-pagination.test.ts
git commit -m "feat(albums): listAlbumPhotos offset pagination + total"
```

---

### Task 5: `searchPhotos` — offset + total

**Files:**
- Modify: `apps/web/src/lib/search-service.ts` (`searchPhotos`)
- Modify: `apps/web/src/lib/list-pagination.test.ts` (append a `describe`)

- [ ] **Step 1: Add the failing test**

Append to `apps/web/src/lib/list-pagination.test.ts`:

```ts
import { searchPhotos } from "./search-service.js";

function searchDb(rows: ReturnType<typeof row>[]) {
  const calls: Array<{ skip?: number; take: number; where?: unknown }> = [];
  return {
    calls,
    photo: {
      findMany: async (args: { skip?: number; take: number; where?: unknown }) => {
        calls.push(args);
        const skip = args.skip ?? 0;
        return rows.slice(skip, skip + args.take);
      },
      count: async () => rows.length,
    },
  };
}

describe("searchPhotos", () => {
  it("returns the page slice + total and applies offset", async () => {
    const db = searchDb([row("a"), row("b"), row("c")]);
    const page = await searchPhotos({ limit: 2, offset: 0, album: [] }, db as never);
    expect(page.items.map((p) => p.id)).toEqual(["a", "b"]);
    expect(page.total).toBe(3);
    expect(db.calls[0]).toMatchObject({ skip: 0, take: 2 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/list-pagination.test.ts -t searchPhotos`
Expected: FAIL — `total` undefined.

- [ ] **Step 3: Rewrite `searchPhotos`**

In `apps/web/src/lib/search-service.ts`, replace the `searchPhotos` function body:

```ts
export async function searchPhotos(params: SearchQuery, db: Db = prisma): Promise<PhotosPage> {
  const { limit, offset, sort } = params;
  const where = buildSearchWhere(params);
  const [rows, total] = await Promise.all([
    db.photo.findMany({ where, skip: offset, take: limit, orderBy: photoOrderBy(sort) }),
    db.photo.count({ where }),
  ]);
  return { items: rows.map(toPhotoDTO), total };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/list-pagination.test.ts -t searchPhotos`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/search-service.ts apps/web/src/lib/list-pagination.test.ts
git commit -m "feat(search): searchPhotos offset pagination + total"
```

---

### Task 6: `listTrash` — offset + total

**Files:**
- Modify: `apps/web/src/lib/trash-service.ts` (`listTrash`)
- Modify: `apps/web/src/lib/list-pagination.test.ts` (append a `describe`)

- [ ] **Step 1: Add the failing test**

Append to `apps/web/src/lib/list-pagination.test.ts`:

```ts
import { listTrash } from "./trash-service.js";

function trashDb(rows: ReturnType<typeof row>[]) {
  const calls: Array<{ skip?: number; take: number; orderBy?: unknown }> = [];
  return {
    calls,
    trashedPhoto: {
      findMany: async (args: { skip?: number; take: number; orderBy?: unknown }) => {
        calls.push(args);
        const skip = args.skip ?? 0;
        return rows.slice(skip, skip + args.take).map((r) => ({
          ...r,
          originalPath: r.path,
          deletedAt: new Date("2024-01-01T00:00:00.000Z"),
          albumIds: [],
        }));
      },
      count: async () => rows.length,
    },
  };
}

describe("listTrash", () => {
  it("returns the page slice + total, ordered by deletedAt, applying offset", async () => {
    const db = trashDb([row("a"), row("b"), row("c")]);
    const page = await listTrash({ limit: 2, offset: 1 }, db as never);
    expect(page.items.map((p) => p.id)).toEqual(["b", "c"]);
    expect(page.total).toBe(3);
    expect(db.calls[0]).toMatchObject({ skip: 1, take: 2 });
    expect(db.calls[0]?.orderBy).toEqual([{ deletedAt: "desc" }, { id: "desc" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/list-pagination.test.ts -t listTrash`
Expected: FAIL — `total` undefined.

- [ ] **Step 3: Rewrite `listTrash`**

In `apps/web/src/lib/trash-service.ts`, replace the `listTrash` function body:

```ts
export async function listTrash(
  params: PhotosQuery,
  db: Db = prisma,
): Promise<PhotosPage> {
  const { limit, offset } = params;
  const [rows, total] = await Promise.all([
    db.trashedPhoto.findMany({
      skip: offset,
      take: limit,
      orderBy: [{ deletedAt: "desc" }, { id: "desc" }],
    }),
    db.trashedPhoto.count(),
  ]);
  return { items: rows.map(toTrashedPhotoDTO), total };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/list-pagination.test.ts`
Expected: PASS (album/search/trash all green).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/trash-service.ts apps/web/src/lib/list-pagination.test.ts
git commit -m "feat(trash): listTrash offset pagination + total"
```

---

### Task 7: Rewrite `use-photo-pages` to offset + sparse store

**Files:**
- Modify: `apps/web/src/lib/grid-layout.ts` (add `PHOTO_PAGE_SIZE`)
- Modify: `apps/web/src/components/photo-grid/use-photo-pages.ts` (full rewrite)

- [ ] **Step 1: Add the page-size constant**

In `apps/web/src/lib/grid-layout.ts`, add near the other constants:

```ts
/** Fixed fetch page size for the grid (independent of column density so the
 *  sparse page store's index math stays stable when columns change). API max. */
export const PHOTO_PAGE_SIZE = 100;
```

- [ ] **Step 2: Rewrite the hook**

Replace the entire contents of `apps/web/src/components/photo-grid/use-photo-pages.ts`:

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PhotoDTO } from "@lumio/shared";
import {
  createPageStore,
  loadedIds as loadedIdsOf,
  pageIndicesForRange,
  patchPages,
  photoAt as photoAtOf,
  removeIds,
  setPage,
  type PageStore,
} from "./photo-page-store";

/** Keep at most this many pages in memory; LRU-evict the rest (refetched on
 *  return). Bounds memory regardless of library size. */
const MAX_PAGES = 60;

async function fetchPage(
  endpoint: string,
  offset: number,
  limit: number,
  extra?: URLSearchParams,
): Promise<{ items: PhotoDTO[]; total: number }> {
  const params = new URLSearchParams(extra);
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  const res = await fetch(`${endpoint}?${params.toString()}`);
  if (!res.ok) throw new Error("Failed to load photos");
  return res.json();
}

/**
 * Offset-paginated, randomly-addressable photo loading for one endpoint. Holds a
 * sparse page store sized to `total`; `ensureRange` fetches whichever pages cover
 * the requested absolute-index span (deduped via an in-flight set). State resets
 * only on remount — album/search views remount via a `key` when scope changes.
 */
export function usePhotoPages(endpoint: string, params?: URLSearchParams, pageSize = 50) {
  const [store, setStore] = useState<PageStore<PhotoDTO>>(() =>
    createPageStore<PhotoDTO>(pageSize, MAX_PAGES),
  );
  const [error, setError] = useState(false);
  const inFlight = useRef<Set<number>>(new Set());
  const lastRange = useRef<[number, number]>([0, 0]);

  const ensureRange = useCallback(
    (startIndex: number, endIndex: number) => {
      lastRange.current = [startIndex, endIndex];
      const needed = pageIndicesForRange(startIndex, endIndex, pageSize).filter(
        (p) => !store.pages.has(p) && !inFlight.current.has(p),
      );
      for (const p of needed) {
        inFlight.current.add(p);
        fetchPage(endpoint, p * pageSize, pageSize, params)
          .then((page) => {
            setStore((prev) => setPage(prev, p, page.items, page.total));
            setError(false);
          })
          .catch(() => setError(true))
          .finally(() => {
            inFlight.current.delete(p);
          });
      }
    },
    [endpoint, params, pageSize, store.pages],
  );

  // First page (also yields total). Re-runs harmlessly on store changes — page 0
  // is then already loaded, so it is a no-op.
  useEffect(() => {
    ensureRange(0, 0);
  }, [ensureRange]);

  const photoAt = useCallback((index: number) => photoAtOf(store, index), [store]);
  const getLoadedIds = useCallback(() => loadedIdsOf(store), [store]);
  const patchPhotos = useCallback(
    (ids: Set<string>, patch: Partial<PhotoDTO>) => setStore((prev) => patchPages(prev, ids, patch)),
    [],
  );
  const removePhotos = useCallback(
    (ids: Set<string>) => setStore((prev) => removeIds(prev, ids)),
    [],
  );
  const retry = useCallback(() => {
    setError(false);
    const [s, e] = lastRange.current;
    ensureRange(s, e);
  }, [ensureRange]);

  return { total: store.total, photoAt, getLoadedIds, ensureRange, patchPhotos, removePhotos, error, retry };
}
```

- [ ] **Step 3: Typecheck the web app**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: PASS — but `photo-grid.tsx` still consumes the old hook API (`photos`, `done`, `loadMore`), so expect remaining errors **only** in `photo-grid.tsx`. If errors appear in any other file, fix them before continuing. (photo-grid.tsx is rewritten next.)

- [ ] **Step 4: Run the unit suite to confirm nothing else broke**

Run: `pnpm --filter @lumio/web exec vitest run`
Expected: PASS (all service + store tests green).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/grid-layout.ts apps/web/src/components/photo-grid/use-photo-pages.ts
git commit -m "feat(grid): offset + sparse-store photo paging hook"
```

---

### Task 8: Rewrite `photo-grid.tsx` — full-count virtualizer, tiled skeleton, prefetch

**Files:**
- Modify: `apps/web/src/components/photo-grid/photo-grid.tsx` (full rewrite of the body that uses the hook)

- [ ] **Step 1: Replace the component**

Replace the entire contents of `apps/web/src/components/photo-grid/photo-grid.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { Images } from "lucide-react";
import { rowCount, GRID_GAP, DEFAULT_COLUMNS, PHOTO_PAGE_SIZE } from "@/lib/grid-layout";
import { computeSelection } from "@/lib/grid-selection";
import type { PhotoDTO, PhotoSort } from "@lumio/shared";
import type { GridViewMode } from "@/lib/use-grid-view";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { usePhotoPages } from "./use-photo-pages";
import { PhotoGridSkeleton } from "./photo-grid-skeleton";
import { PhotoGridTile } from "./photo-grid-tile";

// Default empty state for the all-photos view. Album views pass their own via
// the `empty` prop since the copy differs (an empty album isn't a worker issue).
const PHOTOS_EMPTY = (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <Images />
      </EmptyMedia>
      <EmptyTitle>No photos yet</EmptyTitle>
      <EmptyDescription>
        Drop photos into your library folder, then rescan to import them.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
);

const OVERSCAN_ROWS = 3;

export type PhotoGridHandle = {
  /** Merge `patch` into every loaded photo whose id is in `ids` (e.g. a new colorLabel). */
  patchPhotos: (ids: Set<string>, patch: Partial<PhotoDTO>) => void;
  /** Drop every loaded photo whose id is in `ids` (e.g. after moving to Trash). */
  removePhotos: (ids: Set<string>) => void;
};

export function PhotoGrid({
  endpoint = "/api/photos",
  albumId,
  empty = PHOTOS_EMPTY,
  mode = "fill",
  columns: columnsProp = DEFAULT_COLUMNS,
  params,
  sort,
  hrefFor,
  selectMode = false,
  selectedIds,
  onSelectionChange,
  apiRef,
}: {
  endpoint?: string;
  albumId?: string;
  empty?: React.ReactNode;
  mode?: GridViewMode;
  columns?: number;
  params?: URLSearchParams;
  sort?: PhotoSort;
  hrefFor?: (id: string) => string;
  selectMode?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  apiRef?: React.Ref<PhotoGridHandle>;
}) {
  const columns = Math.max(1, columnsProp);
  const { total, photoAt, getLoadedIds, ensureRange, error, retry, patchPhotos, removePhotos } =
    usePhotoPages(endpoint, params, PHOTO_PAGE_SIZE);
  useImperativeHandle(apiRef, () => ({ patchPhotos, removePhotos }), [patchPhotos, removePhotos]);

  // Index of the last plain-clicked tile, used as the shift-range anchor.
  const anchorRef = useRef<number | null>(null);

  function handleTileClick(index: number, e: React.MouseEvent) {
    if (!onSelectionChange) return;
    // getLoadedIds() is sparse (holes for unloaded indices); computeSelection
    // skips holes, so a shift-range across an unloaded gap selects only loaded ids.
    const next = computeSelection(
      selectedIds ?? new Set<string>(),
      getLoadedIds(),
      index,
      e.shiftKey,
      anchorRef.current,
    );
    if (!e.shiftKey) anchorRef.current = index;
    onSelectionChange(next);
  }

  useEffect(() => {
    if (!selectMode) anchorRef.current = null;
  }, [selectMode]);

  const [width, setWidth] = useState(0);
  const [offsetTop, setOffsetTop] = useState(0);
  const roRef = useRef<ResizeObserver | null>(null);

  // Callback ref so measurement re-attaches whenever the underlying node changes
  // (skeleton → real grid). A one-shot effect would keep observing the detached
  // skeleton and miss window resizes until a refresh.
  const measureRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    if (!el) {
      roRef.current = null;
      return;
    }
    const measure = () => {
      setWidth(el.clientWidth);
      setOffsetTop(el.offsetTop);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    roRef.current = ro;
  }, []);

  const tileSize = width > 0 ? (width - GRID_GAP * (columns - 1)) / columns : 0;
  const rows = rowCount(total ?? 0, columns);

  const virtualizer = useWindowVirtualizer({
    count: rows,
    estimateSize: () => tileSize + GRID_GAP,
    overscan: OVERSCAN_ROWS,
    scrollMargin: offsetTop,
  });

  useEffect(() => {
    virtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tileSize, columns]);

  const items = virtualizer.getVirtualItems();

  // Fetch the pages covering the visible rows plus ~2 pages of read-ahead, so
  // content streams in before the user reaches it (and holes fill when the
  // scrollbar is dragged). The hook dedupes and caps in-flight requests.
  const prefetchRows = Math.ceil((2 * PHOTO_PAGE_SIZE) / columns);
  useEffect(() => {
    if (items.length === 0) return;
    const firstRow = items[0]!.index;
    const lastRow = items[items.length - 1]!.index;
    ensureRange(firstRow * columns, (lastRow + prefetchRows) * columns + (columns - 1));
  }, [items, columns, prefetchRows, ensureRange]);

  if (total === 0) {
    return <>{empty}</>;
  }

  // First paint, before `total` is known: the CSS skeleton grid (server-rendered).
  if (total === null) {
    return <PhotoGridSkeleton listRef={measureRef} columns={columns} />;
  }

  // Compositor-painted skeleton: a muted rounded square tiled at the grid's exact
  // cell pitch. Shows beneath unloaded cells and even on frames a row hasn't
  // rendered yet during a fast fling — so there is never a white flash.
  const cell = tileSize + GRID_GAP;
  const squareSvg = encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${cell}' height='${cell}'>` +
      `<rect width='${tileSize}' height='${tileSize}' rx='3' fill='rgba(128,128,128,0.16)'/></svg>`,
  );

  return (
    <div ref={measureRef}>
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: "100%",
          position: "relative",
          backgroundImage: tileSize > 0 ? `url("data:image/svg+xml,${squareSvg}")` : undefined,
          backgroundSize: `${cell}px ${cell}px`,
        }}
      >
        {items.map((vrow) => {
          const start = vrow.index * columns;
          return (
            <div
              key={vrow.key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: tileSize,
                transform: `translateY(${vrow.start - virtualizer.options.scrollMargin}px)`,
                display: "grid",
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                gridAutoRows: `${tileSize}px`,
                gap: GRID_GAP,
              }}
            >
              {Array.from({ length: columns }, (_, i) => {
                const idx = start + i;
                // Past the last photo (last row's trailing cells): nothing.
                if (idx >= total) return <div key={i} aria-hidden />;
                const photo = photoAt(idx);
                // Unloaded cell: a transparent spacer keeps grid alignment; the
                // container's tiled skeleton shows through it.
                if (!photo) return <div key={i} aria-hidden />;
                return (
                  <PhotoGridTile
                    key={photo.id}
                    photo={photo}
                    mode={mode}
                    albumId={albumId}
                    sort={sort}
                    hrefFor={hrefFor}
                    selectMode={selectMode}
                    isSelected={selectedIds?.has(photo.id) ?? false}
                    index={idx}
                    onTileClick={handleTileClick}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
      {error && (
        <div className="py-4 text-center">
          <button onClick={() => retry()} className="text-sm text-muted-foreground underline">
            Failed to load — retry
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: PASS — no errors anywhere now.

- [ ] **Step 3: Browser verification** (UI is verified in-browser, per project convention)

Start the dev server if not running, open `https://manado.lumio.localhost:1355/photos`, and confirm:
- The scrollbar is **full-height immediately** (thumb is small, reflecting all ~5k).
- A fast fling **never hits a hard wall** and **never flashes white** — unloaded cells show the gray skeleton squares, then fill.
- **Dragging the scrollbar to the middle** loads that region (skeleton → photos).
- Album view (`/albums/<id>`), search results, and trash grids still render and scroll.
- Select mode: click + shift-click select; bulk delete removes tiles in place and the grid stays correct on continued scroll.

Quick instrumented check (paste in DevTools console): the timeline container height should be the full library height, not just loaded content:

```js
[...document.querySelectorAll('div')].find(d => d.style.position==='relative' && parseFloat(d.style.height)>5000)?.style.height
```

Expected: a value ≈ `rows × (tileSize+4)` for ALL photos (tens of thousands of px), present even right after load.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/photo-grid/photo-grid.tsx
git commit -m "feat(grid): full-height virtualizer, tiled skeleton, read-ahead prefetch"
```

---

### Task 9: `decoding="async"` on the thumbnail image

**Files:**
- Modify: `apps/web/src/components/photo-grid/photo-thumb.tsx:23-37` (the `<img>`)

- [ ] **Step 1: Add the attribute**

In `apps/web/src/components/photo-grid/photo-thumb.tsx`, add `decoding="async"` to the `<img>` (next to `loading="lazy"`):

```tsx
      <img
        src={`/api/thumbnails/${photo.id}`}
        alt={photo.path}
        loading="lazy"
        decoding="async"
        width={w}
        height={h}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Browser verification**

Reload `/photos`, fling fast — image appearance is no longer gated on synchronous decode (smoother). No visual regressions.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/photo-grid/photo-thumb.tsx
git commit -m "perf(grid): async-decode thumbnails to keep decode off the main thread"
```

---

### Task 10: Enable Better Auth cookie cache (image-serving fast path)

**Files:**
- Modify: `apps/web/src/lib/auth.ts:33-54` (the `betterAuth({ ... })` config)

- [ ] **Step 1: Add the session cookie cache**

In `apps/web/src/lib/auth.ts`, add a `session` block to the `betterAuth({ ... })` config (e.g. just after `appName`/`secret`, before `plugins`):

```ts
  session: {
    // Validate a signed session cookie instead of querying Postgres on every
    // request. Removes the per-thumbnail / per-display DB session lookup. A
    // revoked session stays valid until this TTL expires.
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Browser verification**

- Reload `/photos` — thumbnails still load (auth still passes).
- In DevTools Network, thumbnail requests are 200 and fast; the page's session/DB lookups per image drop (visible as lower `application-code` time in the dev-server log for `/api/thumbnails/...` on warm requests).
- Log out and back in once to confirm the session flow still works end-to-end.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/auth.ts
git commit -m "perf(auth): enable session cookie cache to drop per-image DB lookups"
```

---

### Task 11: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the entire test suite**

Run: `pnpm -r test`
Expected: PASS across all packages (shared schema test, web service + store tests).

- [ ] **Step 2: Typecheck the web app**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Production build (catches anything dev hides)**

Run: `pnpm --filter @lumio/web build`
Expected: build succeeds.

- [ ] **Step 4: End-to-end browser pass on `/photos`, `/albums/<id>`, `/search`, `/trash`**

Confirm against the spec's success criteria:
- Full-height scrollbar from first paint.
- Fast fling: no hard wall, no white flash (gray skeleton then fill).
- Drag-to-middle loads that region.
- Memory stays bounded after scrolling the whole library (DevTools Memory: DOM node count stays ~one screenful of tiles; the store caps at `MAX_PAGES`).
- Select + bulk delete keeps the grid correct on continued scroll.

- [ ] **Step 5: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "chore(grid): phase 1 verification fixups" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**
- Full-height scrollbar → Task 8 (`count = rowCount(total, columns)`). ✓
- Compositor-painted skeleton, no white flash → Task 8 (tiled SVG background). ✓
- Render only loaded cells / spacers for holes → Task 8. ✓
- Read-ahead prefetch (~2 pages) → Task 8 (`prefetchRows`) + Task 7 (`ensureRange`). ✓
- Bounded memory (LRU eviction) → Task 1 (`setPage` eviction, `MAX_PAGES`) + Task 7. ✓
- Offset + total across 4 services → Tasks 3–6. ✓
- Shared type/schema change → Task 2. ✓
- Optimistic patch/remove with shift/eviction → Task 1 (`patchPages`/`removeIds`) + Task 7. ✓
- Shift-select across gap = loaded subset → Task 8 (sparse `getLoadedIds`). ✓
- `decoding="async"` → Task 9. ✓
- Cookie cache → Task 10. ✓
- Phase 2 (ThumbHash) intentionally excluded. ✓

**Placeholder scan:** none — every code step shows complete code; every run step has an exact command + expected result.

**Type consistency:** `PageStore<T>`, `setPage`, `removeIds`, `patchPages`, `loadedIds`, `photoAt`, `pageIndicesForRange` are used identically in Task 1 (definition), Task 7 (hook), and Task 8 (grid). Hook returns `{ total, photoAt, getLoadedIds, ensureRange, patchPhotos, removePhotos, error, retry }` — the exact set Task 8 destructures. Services return `{ items, total }` matching the Task 2 `PhotosPage`. `PHOTO_PAGE_SIZE` defined in Task 7, consumed in Task 8.
