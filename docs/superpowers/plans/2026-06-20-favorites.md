# Favorites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users mark photos as favorites (♥) — singly or in bulk — from the grid hover overlay, selection toolbar, right-click menu, and lightbox; browse them at `/favorites`; and see a persistent heart badge on favorited tiles.

**Architecture:** A boolean `isFavorite` column on `Photo` (mirroring the existing `colorLabel` field) flows through mapper → DTO → service → API → the shared `usePhotoActions` layer. A new `favorite()` action does the network call + optimistic store update; every surface (toolbar button, context-menu item, hover heart, lightbox toggle) calls it. The `/favorites` page reuses the existing grid/lightbox/selection machinery, filtered by `?favorite=true`.

**Tech Stack:** Next.js (App Router, `--webpack`), React 19 + React Compiler, Prisma/PostgreSQL, Zod, Tailwind, shadcn/ui, lucide-react, vitest, pnpm workspaces.

**Conventions to honor:**
- Client components start with `"use client"` on line 1.
- Don't write to refs during render/effects; call methods on `ref.current` is fine.
- Use the existing `Db = Pick<PrismaClient, "photo">` injection for service tests.
- Commit after every task.

**Verification commands (used throughout):**
- Shared tests: `pnpm --filter @lumio/shared test`
- DB tests: `pnpm --filter @lumio/db test`
- Web tests: `pnpm --filter @lumio/web test`
- Web typecheck: `pnpm --filter @lumio/web exec tsc --noEmit`
- Web lint: `pnpm --filter @lumio/web lint`

**Known v1 limitations (out of scope, noted for follow-up):**
- The `/favorites` lightbox uses the library `photoHref` (no dedicated `DetailScope`), so a hard refresh of a deep-linked favorite walks the whole library for arrow neighbors. In-app arrow nav and the film strip stay favorites-scoped (they read the provider's own collection).
- Unfavoriting a *selected* photo via its hover heart in the `/favorites` view leaves its (now-removed) id in the selection set until the next selection change. Harmless; not cleaned up.
- The lightbox sidebar favorite toggle is **patch-only** (it flips the heart in place) on every surface, including `/favorites` — it does NOT drop the photo from the favorites grid the way the hover heart / toolbar / context menu do. This is deliberate: the sidebar must also work on the standalone `/photo/[id]` route, which has no `PhotoActionsProvider`, and removing the open photo would need extra lightbox last-item/close handling. Net effect: unfavoriting from the detail view leaves the photo in the `/favorites` grid (with an empty heart) until you navigate away or reload. Follow-up: add a `favorites` `DetailScope` + route the sidebar through the shared action so all five surfaces share one path.
- The toolbar `FavoriteButton` is always an outline heart; it does not render a filled state when the whole selection is already favorited (the design spec mentioned this). Computing fill would require running the smart-toggle target on every render rather than only on click; deferred as a minor polish.

---

## Task 1: DB — `Photo.isFavorite` column, migration, and mapper

**Files:**
- Modify: `packages/db/prisma/schema.prisma:26-47` (Photo model)
- Modify: `packages/db/src/mappers.ts:11-43` (toPhotoDTO, toTrashedPhotoDTO)
- Test: `packages/db/src/mappers.test.ts`

**Prerequisite:** the dev database must be running (`pnpm db:up`).

- [ ] **Step 1: Add the field + index to the schema**

In `packages/db/prisma/schema.prisma`, add `isFavorite` after `colorLabel` and a composite index alongside the existing ones:

```prisma
model Photo {
  id          String       @id @default(cuid())
  path        String       @unique
  source      PhotoSource
  takenAt     DateTime?
  sortDate    DateTime     @default(now())
  width       Int
  height      Int
  hash        String?
  thumbhash   String?
  fileSize    Int? // bytes from fs.stat; nullable so existing rows migrate cleanly
  fileMtimeMs Float? // mtimeMs from fs.stat (fractional ms) — change-detection signal
  exif        Json
  colorLabel  ColorLabel?
  isFavorite  Boolean      @default(false)
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt
  albums      AlbumPhoto[]

  @@index([sortDate, id])
  @@index([createdAt, id])
  @@index([hash])
  @@index([isFavorite, sortDate])
}
```

- [ ] **Step 2: Generate and apply the migration**

Run:
```bash
pnpm --filter @lumio/db migrate --name add_photo_is_favorite
```
Expected: a new folder `packages/db/prisma/migrations/<timestamp>_add_photo_is_favorite/migration.sql` containing roughly:
```sql
ALTER TABLE "Photo" ADD COLUMN "isFavorite" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Photo_isFavorite_sortDate_idx" ON "Photo"("isFavorite", "sortDate");
```
`migrate dev` also regenerates the Prisma client, so the `Photo` type now has `isFavorite: boolean`.

- [ ] **Step 3: Write the failing mapper test**

In `packages/db/src/mappers.test.ts`, update both `toPhotoDTO` literals to include `isFavorite` and assert it, and assert the trashed mapper defaults to `false`. Replace the first `toPhotoDTO` `it` block and add an assertion to the trashed block:

```ts
  it("maps a Prisma photo row to a PhotoDTO with ISO dates", () => {
    const row = {
      id: "p1",
      path: "vacation/img1.jpg",
      source: "filesystem" as const,
      takenAt: new Date("2024-01-15T12:00:00.000Z"),
      sortDate: new Date("2024-01-15T12:00:00.000Z"),
      width: 800,
      height: 600,
      hash: "abc",
      thumbhash: null,
      fileSize: null,
      fileMtimeMs: null,
      exif: { cameraMake: "Lumio" },
      colorLabel: null,
      isFavorite: true,
      createdAt: new Date("2024-02-01T00:00:00.000Z"),
      updatedAt: new Date("2024-02-02T00:00:00.000Z"),
    };

    const dto = toPhotoDTO(row);

    expect(dto.id).toBe("p1");
    expect(dto.source).toBe(PhotoSource.filesystem);
    expect(dto.takenAt).toBe("2024-01-15T12:00:00.000Z");
    expect(dto.createdAt).toBe("2024-02-01T00:00:00.000Z");
    expect(dto.exif).toEqual({ cameraMake: "Lumio" });
    expect(dto.isFavorite).toBe(true);
  });
```

In the second `toPhotoDTO` `it` block (`"maps a null takenAt to null"`), add `isFavorite: false,` after `colorLabel: null,` in the object passed to `toPhotoDTO`, and add `expect(dto.isFavorite).toBe(false);` before the closing brace.

In the `toTrashedPhotoDTO` block, add after `expect(dto.colorLabel).toBe("blue");`:
```ts
    expect(dto.isFavorite).toBe(false);
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @lumio/db test`
Expected: FAIL — `toPhotoDTO` returns an object without `isFavorite` (`expect(dto.isFavorite).toBe(true)` fails / type error on the literal).

- [ ] **Step 5: Implement the mapper changes**

In `packages/db/src/mappers.ts`, add `isFavorite` to `toPhotoDTO` (after the `colorLabel` line):
```ts
    colorLabel: row.colorLabel as ColorLabel | null,
    isFavorite: row.isFavorite,
```
And in `toTrashedPhotoDTO`, add after its `colorLabel` line (trashed rows have no favorite column — always `false`):
```ts
    colorLabel: row.colorLabel as ColorLabel | null,
    isFavorite: false,
```

> Note: this will not typecheck until Task 2 adds `isFavorite` to `PhotoDTO`. That's expected — the DB test run in Step 6 still passes at runtime; the cross-package typecheck happens in Task 2's verification. If you prefer green types here, do Task 2 Step 1 (the `PhotoDTO` field) first.

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @lumio/db test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations packages/db/src/mappers.ts packages/db/src/mappers.test.ts
git commit -m "feat(db): add Photo.isFavorite column + map to DTO"
```

---

## Task 2: Shared — `PhotoDTO.isFavorite`, `computeFavoriteTarget`, and favorite API schemas

**Files:**
- Modify: `packages/shared/src/types.ts:13-28` (PhotoDTO)
- Create: `packages/shared/src/favorites.ts`
- Test: `packages/shared/src/favorites.test.ts`
- Modify: `packages/shared/src/api.ts:35-40, 80-86` (photosQuerySchema, add setFavoriteSchema)
- Modify: `packages/shared/src/api.test.ts`
- Modify: `packages/shared/src/index.ts` (export favorites)

- [ ] **Step 1: Add `isFavorite` to `PhotoDTO`**

In `packages/shared/src/types.ts`, add it after `colorLabel`:
```ts
  exif: ExifData;
  colorLabel: ColorLabel | null;
  isFavorite: boolean;
  createdAt: string;
```

- [ ] **Step 2: Write the failing `computeFavoriteTarget` test**

Create `packages/shared/src/favorites.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { computeFavoriteTarget } from "./favorites.js";

describe("computeFavoriteTarget", () => {
  it("returns true (favorite all) for an empty set", () => {
    expect(computeFavoriteTarget([])).toBe(true);
  });

  it("returns true when some are not favorited", () => {
    expect(
      computeFavoriteTarget([{ isFavorite: true }, { isFavorite: false }]),
    ).toBe(true);
  });

  it("returns true when none are favorited", () => {
    expect(
      computeFavoriteTarget([{ isFavorite: false }, { isFavorite: false }]),
    ).toBe(true);
  });

  it("returns false (unfavorite all) when every one is favorited", () => {
    expect(
      computeFavoriteTarget([{ isFavorite: true }, { isFavorite: true }]),
    ).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @lumio/shared test`
Expected: FAIL — `Cannot find module './favorites.js'` / `computeFavoriteTarget is not defined`.

- [ ] **Step 4: Implement `computeFavoriteTarget`**

Create `packages/shared/src/favorites.ts`:
```ts
import type { PhotoDTO } from "./types.js";

/**
 * Smart-toggle target for a favorite action over a set of photos: favorite all
 * of them unless every one is already favorited, in which case unfavorite all.
 * An empty set favorites (returns true).
 */
export function computeFavoriteTarget(
  photos: Pick<PhotoDTO, "isFavorite">[],
): boolean {
  return !(photos.length > 0 && photos.every((p) => p.isFavorite));
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @lumio/shared test`
Expected: PASS.

- [ ] **Step 6: Write the failing API-schema tests**

In `packages/shared/src/api.test.ts`, add `setFavoriteSchema` to the imports:
```ts
import {
  coercePhotoSort,
  photosQuerySchema,
  searchQuerySchema,
  setColorLabelSchema,
  setFavoriteSchema,
} from "./api.js";
```
Append these two describe blocks at the end of the file:
```ts
describe("photosQuerySchema favorite", () => {
  it("leaves favorite undefined when absent", () => {
    expect(photosQuerySchema.parse({}).favorite).toBeUndefined();
  });

  it("parses favorite=true to boolean true", () => {
    expect(photosQuerySchema.parse({ favorite: "true" }).favorite).toBe(true);
  });

  it("parses favorite=false to boolean false", () => {
    expect(photosQuerySchema.parse({ favorite: "false" }).favorite).toBe(false);
  });

  it("rejects a non-boolean favorite", () => {
    expect(photosQuerySchema.safeParse({ favorite: "yes" }).success).toBe(false);
  });
});

describe("setFavoriteSchema", () => {
  it("accepts photoIds with isFavorite true/false", () => {
    expect(setFavoriteSchema.parse({ photoIds: ["a"], isFavorite: true }).isFavorite).toBe(true);
    expect(setFavoriteSchema.parse({ photoIds: ["a", "b"], isFavorite: false }).photoIds).toEqual([
      "a",
      "b",
    ]);
  });

  it("rejects an empty photoIds array", () => {
    expect(() => setFavoriteSchema.parse({ photoIds: [], isFavorite: true })).toThrow();
  });

  it("rejects a missing isFavorite", () => {
    expect(setFavoriteSchema.safeParse({ photoIds: ["a"] }).success).toBe(false);
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `pnpm --filter @lumio/shared test`
Expected: FAIL — `setFavoriteSchema` is not exported; `favorite` parsing fails.

- [ ] **Step 8: Implement the schema changes**

In `packages/shared/src/api.ts`, extend `photosQuerySchema` with a `favorite` flag:
```ts
/** Query params for GET /api/photos. */
export const photosQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  sort: photoSortSchema.optional(),
  month: monthParamSchema.optional(),
  favorite: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});
```
And add the mutation body schema after `setColorLabelSchema` (end of file):
```ts
/** Body for POST /api/photos/favorite. */
export const setFavoriteSchema = z.object({
  photoIds: z.array(z.string().min(1)).min(1),
  isFavorite: z.boolean(),
});

export type SetFavoriteBody = z.infer<typeof setFavoriteSchema>;
```

- [ ] **Step 9: Export the favorites module**

In `packages/shared/src/index.ts`, add after the `color-labels` export:
```ts
export * from "./color-labels.js";
export * from "./favorites.js";
```

- [ ] **Step 10: Run shared tests + cross-package typecheck**

Run: `pnpm --filter @lumio/shared test`
Expected: PASS.
Run: `pnpm --filter @lumio/db test`
Expected: PASS (the mapper now typechecks against the new `PhotoDTO`).

- [ ] **Step 11: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/favorites.ts packages/shared/src/favorites.test.ts packages/shared/src/api.ts packages/shared/src/api.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): isFavorite DTO field, computeFavoriteTarget, favorite API schemas"
```

---

## Task 3: Service — `setPhotoFavorite` + `listPhotos` favorite filter

**Files:**
- Modify: `apps/web/src/lib/photos-service.ts:18-29` (listPhotos), add `setPhotoFavorite`
- Test: `apps/web/src/lib/photos-service.test.ts`

- [ ] **Step 1: Write the failing service tests**

In `apps/web/src/lib/photos-service.test.ts`, add `setPhotoFavorite` to the imports:
```ts
import {
  getNeighborsForWhere,
  getPhotoNeighbors,
  listPhotos,
  setPhotoColorLabel,
  setPhotoFavorite,
} from "./photos-service.js";
```
Add two cases inside the existing `describe("listPhotos", ...)` block:
```ts
  it("filters by isFavorite when favorite is true", async () => {
    const db = fakeDb([row("a")]);
    await listPhotos({ limit: 50, offset: 0, favorite: true }, db as never);
    expect(db.calls[0]?.where).toEqual({ isFavorite: true });
  });

  it("uses an empty where when favorite is false", async () => {
    const db = fakeDb([row("a")]);
    await listPhotos({ limit: 50, offset: 0, favorite: false }, db as never);
    expect(db.calls[0]?.where).toEqual({});
  });
```
Add a new describe block after `describe("setPhotoColorLabel", ...)`:
```ts
describe("setPhotoFavorite", () => {
  it("sets isFavorite on the given photos and returns the count", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const db = { photo: { updateMany } };
    const count = await setPhotoFavorite(["p1", "p2"], true, db as never);
    expect(count).toBe(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["p1", "p2"] } },
      data: { isFavorite: true },
    });
  });

  it("clears isFavorite when given false", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = { photo: { updateMany } };
    await setPhotoFavorite(["p1"], false, db as never);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["p1"] } },
      data: { isFavorite: false },
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @lumio/web test photos-service`
Expected: FAIL — `setPhotoFavorite` not exported; `favorite: true` produces no `isFavorite` in the `where`.

- [ ] **Step 3: Implement the service changes**

In `apps/web/src/lib/photos-service.ts`, rewrite the `listPhotos` `where` construction (lines 22-23) to compose month + favorite:
```ts
export async function listPhotos(
  params: PhotosQuery,
  db: Db = prisma,
): Promise<PhotosPage> {
  const { limit, offset, sort, month, favorite } = params;
  const where: Prisma.PhotoWhereInput = {};
  if (month) where.sortDate = monthRange(month);
  if (favorite) where.isFavorite = true;
  const [rows, total] = await Promise.all([
    db.photo.findMany({ where, skip: offset, take: limit, orderBy: photoOrderBy(sort) }),
    db.photo.count({ where }),
  ]);
  return { items: rows.map(toPhotoDTO), total };
}
```
Add `setPhotoFavorite` after `setPhotoColorLabel`:
```ts
/**
 * Set the favorite flag on a batch of photos. Returns the number of rows updated.
 */
export async function setPhotoFavorite(
  photoIds: string[],
  isFavorite: boolean,
  db: Db = prisma,
): Promise<number> {
  const { count } = await db.photo.updateMany({
    where: { id: { in: photoIds } },
    data: { isFavorite },
  });
  return count;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @lumio/web test photos-service`
Expected: PASS (including the pre-existing `"uses an empty where when no month is set"` case, which still sees `{}`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/photos-service.ts apps/web/src/lib/photos-service.test.ts
git commit -m "feat(service): setPhotoFavorite + listPhotos favorite filter"
```

---

## Task 4: API — `POST /api/photos/favorite`

The `GET /api/photos` route needs **no change**: it already passes the parsed query to `listPhotos`, which now honors `favorite`.

**Files:**
- Create: `apps/web/src/app/api/photos/favorite/route.ts`

- [ ] **Step 1: Create the route (mirrors `color-label/route.ts`)**

```ts
import { NextResponse } from "next/server";
import { setFavoriteSchema } from "@lumio/shared";
import { setPhotoFavorite } from "@/lib/photos-service";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withAuth(async (request) => {
  const body: unknown = await request.json();
  const parsed = setFavoriteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const count = await setPhotoFavorite(parsed.data.photoIds, parsed.data.isFavorite);
  return NextResponse.json({ status: "favorited", count });
});
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/photos/favorite/route.ts
git commit -m "feat(api): POST /api/photos/favorite"
```

---

## Task 5: Store — `getPhotos(ids)` lookup (page store → collection → grid handle)

This gives the toolbar and context menu the current favorite state of a selection (for the smart toggle) without an O(total) scan per render.

**Files:**
- Modify: `apps/web/src/components/photo-grid/photo-page-store.ts` (add `photosByIds`)
- Test: `apps/web/src/components/photo-grid/photo-page-store.test.ts`
- Modify: `apps/web/src/components/photo-grid/use-photo-pages.ts:5-14, 84-100`
- Modify: `apps/web/src/components/photo-grid/photo-collection.tsx:24-40, 102-111, 236-269`
- Modify: `apps/web/src/components/photo-grid/photo-grid.tsx:39-44, 62-66`

- [ ] **Step 1: Write the failing `photosByIds` test**

In `apps/web/src/components/photo-grid/photo-page-store.test.ts`, add `photosByIds` to the existing import from `./photo-page-store`, then append:
```ts
describe("photosByIds", () => {
  it("returns loaded photos whose id is in the set, skipping unloaded ids", () => {
    let store = createPageStore<{ id: string; n: number }>(2, 10);
    store = setPage(store, 0, [{ id: "a", n: 1 }, { id: "b", n: 2 }], 4);
    store = setPage(store, 1, [{ id: "c", n: 3 }, { id: "d", n: 4 }], 4);
    const got = photosByIds(store, new Set(["a", "c", "zzz"]));
    expect(got.map((p) => p.id).sort()).toEqual(["a", "c"]);
  });

  it("returns an empty array when nothing matches", () => {
    const store = createPageStore<{ id: string }>(2, 10);
    expect(photosByIds(store, new Set(["x"]))).toEqual([]);
  });
});
```
(If `createPageStore`/`setPage` aren't already imported in that test file, add them to the import.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @lumio/web test photo-page-store`
Expected: FAIL — `photosByIds is not a function`.

- [ ] **Step 3: Implement `photosByIds`**

In `apps/web/src/components/photo-grid/photo-page-store.ts`, add after `loadedIds`:
```ts
/** Loaded photos whose id is in `ids` (arbitrary order). For bulk actions that
 *  need the current state of a selection, e.g. the favorite smart-toggle. Skips
 *  ids on pages that aren't loaded. */
export function photosByIds<T extends { id: string }>(
  store: PageStore<T>,
  ids: Set<string>,
): T[] {
  const out: T[] = [];
  for (const items of store.pages.values()) {
    for (const it of items) if (ids.has(it.id)) out.push(it);
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @lumio/web test photo-page-store`
Expected: PASS.

- [ ] **Step 5: Expose `getPhotos` from the hook**

In `apps/web/src/components/photo-grid/use-photo-pages.ts`, add `photosByIds` to the import block from `./photo-page-store`:
```ts
import {
  createPageStore,
  loadedIds as loadedIdsOf,
  pageIndicesForRange,
  patchPages,
  photoAt as photoAtOf,
  photosByIds,
  removeIds,
  setPage,
  type PageStore,
} from "./photo-page-store";
```
Add the callback after `getLoadedIds` (line 85):
```ts
  const getPhotos = useCallback((ids: Set<string>) => photosByIds(store, ids), [store]);
```
And add `getPhotos` to the returned object (line 100):
```ts
  return { total: store.total, photoAt, getLoadedIds, getPhotos, ensureRange, patchPhotos, removePhotos, error, retry };
```

- [ ] **Step 6: Thread `getPhotos` through the collection context**

In `apps/web/src/components/photo-grid/photo-collection.tsx`:

Add to the `PhotoCollectionValue` interface (after `getLoadedIds`):
```ts
  getLoadedIds: () => string[];
  getPhotos: (ids: Set<string>) => PhotoDTO[];
```
Add `getPhotos` to the store destructure (the `const { total, photoAt, getLoadedIds, ... } = store;` block):
```ts
  const {
    total,
    photoAt,
    getLoadedIds,
    getPhotos,
    ensureRange,
    patchPhotos,
    removePhotos,
    error,
    retry,
  } = store;
```
Add `getPhotos` to the `value` object and its memo dependency array (alongside `getLoadedIds` in both places):
```ts
      photoAt: photoForIndex,
      getLoadedIds,
      getPhotos,
      ensureRange,
```
```ts
      photoForIndex,
      getLoadedIds,
      getPhotos,
      ensureRange,
```

- [ ] **Step 7: Expose `getPhotos` on the grid handle**

In `apps/web/src/components/photo-grid/photo-grid.tsx`:

Add to `PhotoGridHandle` (after `removePhotos`):
```ts
export type PhotoGridHandle = {
  /** Merge `patch` into every loaded photo whose id is in `ids` (e.g. a new colorLabel). */
  patchPhotos: (ids: Set<string>, patch: Partial<PhotoDTO>) => void;
  /** Drop every loaded photo whose id is in `ids` (e.g. after moving to Trash). */
  removePhotos: (ids: Set<string>) => void;
  /** Loaded photos for `ids` — for selection-aware bulk actions (favorite toggle). */
  getPhotos: (ids: Set<string>) => PhotoDTO[];
};
```
Add `getPhotos` to the `usePhotoCollection()` destructure (line 62-65) and the `useImperativeHandle` (line 66):
```ts
  const {
    total, photoAt, getLoadedIds, ensureRange, error, retry,
    patchPhotos, removePhotos, getPhotos, open, urlForId, enableLightbox,
  } = usePhotoCollection();
  useImperativeHandle(apiRef, () => ({ patchPhotos, removePhotos, getPhotos }), [patchPhotos, removePhotos, getPhotos]);
```

- [ ] **Step 8: Typecheck + tests**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: PASS.
Run: `pnpm --filter @lumio/web test photo-page-store`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/photo-grid/photo-page-store.ts apps/web/src/components/photo-grid/photo-page-store.test.ts apps/web/src/components/photo-grid/use-photo-pages.ts apps/web/src/components/photo-grid/photo-collection.tsx apps/web/src/components/photo-grid/photo-grid.tsx
git commit -m "feat(grid): getPhotos(ids) lookup through store, collection, and handle"
```

---

## Task 6: Photo-actions — `favorite()` action + `dropOnUnfavorite`

**Files:**
- Modify: `apps/web/src/components/photo-actions/use-photo-actions.tsx:15-28, 40-59, 175-185`

- [ ] **Step 1: Add `favorite` to the `PhotoActions` interface**

In `apps/web/src/components/photo-actions/use-photo-actions.tsx`, update the interface:
```ts
export interface PhotoActions {
  download: (ids: string[], opts?: ActionOpts) => Promise<void>;
  applyLabel: (ids: string[], label: ColorLabel | null, opts?: ActionOpts) => Promise<void>;
  trash: (ids: string[], opts?: ActionOpts) => Promise<void>;
  /** Set the favorite flag on the given photos (optimistic). */
  favorite: (ids: string[], isFavorite: boolean, opts?: ActionOpts) => Promise<void>;
  /** Open the "create / pick album" dialog (the "New album…" path). */
  addToAlbum: (ids: string[], opts?: ActionOpts) => void;
  /** Add straight to an existing album, no dialog (the nested-menu path). */
  addToAlbumDirect: (ids: string[], albumId: string, opts?: ActionOpts) => Promise<void>;
  /** The album currently being viewed, so album pickers can exclude it. */
  excludeAlbumId?: string;
  pending: { download: boolean; label: boolean; trash: boolean; favorite: boolean };
  /** Dialogs (add-to-album + trash confirm). Render once per view. */
  element: React.ReactNode;
}
```

- [ ] **Step 2: Add the `dropOnUnfavorite` option + state + action**

Add `dropOnUnfavorite` to the hook's destructured options (after `onTrashed`):
```ts
export function usePhotoActions({
  gridRef,
  excludeAlbumId,
  trashDescription = DEFAULT_TRASH_DESCRIPTION,
  onTrashed,
  dropOnUnfavorite = false,
}: {
  gridRef: React.RefObject<PhotoGridHandle | null>;
  excludeAlbumId?: string;
  trashDescription?: string;
  onTrashed?: (ids: string[]) => void;
  /** In a favorites-only view, removing a favorite drops the tile from the grid
   *  instead of just clearing its heart. */
  dropOnUnfavorite?: boolean;
}): PhotoActions {
```
Add the pending state alongside the others (after `const [deleting, setDeleting] = useState(false);`):
```ts
  const [favoritePending, setFavoritePending] = useState(false);
```
Add the `favorite` callback after `applyLabel` (before `trash`):
```ts
  const favorite = useCallback(
    async (ids: string[], isFavorite: boolean, opts?: ActionOpts) => {
      if (ids.length === 0 || favoritePending) return;
      setFavoritePending(true);
      try {
        const res = await fetch("/api/photos/favorite", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ photoIds: ids, isFavorite }),
        });
        if (!res.ok) throw new Error("favorite failed");
        if (!isFavorite && dropOnUnfavorite) {
          gridRef.current?.removePhotos(new Set(ids));
        } else {
          gridRef.current?.patchPhotos(new Set(ids), { isFavorite });
        }
        opts?.onSuccess?.();
      } catch {
        toast.error("Failed to update favorites.");
      } finally {
        setFavoritePending(false);
      }
    },
    [favoritePending, gridRef, dropOnUnfavorite],
  );
```

- [ ] **Step 3: Return the new action + pending flag**

Update the return object:
```ts
  return {
    download,
    applyLabel,
    trash,
    favorite,
    addToAlbum,
    addToAlbumDirect,
    excludeAlbumId,
    pending: { download: downloading, label: labelPending, trash: deleting, favorite: favoritePending },
    element,
  };
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/photo-actions/use-photo-actions.tsx
git commit -m "feat(photo-actions): favorite() action with optimistic update + dropOnUnfavorite"
```

---

## Task 7: Context menu — Favorite / Remove item (smart toggle)

**Files:**
- Modify: `apps/web/src/components/photo-grid/photo-context-menu.tsx`

- [ ] **Step 1: Add imports + favorite-target state**

In `apps/web/src/components/photo-grid/photo-context-menu.tsx`:

Add `useState` and the `Heart` icon and the shared helpers:
```ts
"use client";

import { useState } from "react";
import { Download, FolderPlus, Heart, Palette, Trash2 } from "lucide-react";
import { COLOR_LABELS, computeFavoriteTarget } from "@lumio/shared";
```
Add the collection import (next to the actions-context import):
```ts
import { usePhotoActionsContext } from "@/components/photo-actions/photo-actions-context";
import { usePhotoCollection } from "./photo-collection";
import { AlbumPickerItems } from "@/components/photo-actions/album-picker-items";
```

- [ ] **Step 2: Compute the favorite target on open**

Replace the top of the component (the `const actions = usePhotoActionsContext();` line and the early return) with hooks-first ordering:
```ts
  const actions = usePhotoActionsContext();
  const collection = usePhotoCollection();
  const [favoriteTarget, setFavoriteTarget] = useState(true);
  if (!actions) return <>{children}</>;
```
Add `onOpenChange` to the `<ContextMenu>` element so the label/target reflect the selection only when the menu opens:
```tsx
    <ContextMenu
      onOpenChange={(open) => {
        if (open) setFavoriteTarget(computeFavoriteTarget(collection.getPhotos(new Set(targetIds))));
      }}
    >
```

- [ ] **Step 3: Add the Favorite menu item**

Inside the `<ContextMenuGroup>`, after the Color-label `</ContextMenuSub>` and before `</ContextMenuGroup>`:
```tsx
          <ContextMenuItem onSelect={() => void actions.favorite(targetIds, favoriteTarget)}>
            <Heart aria-hidden />
            {favoriteTarget ? `Favorite ${photos}` : `Remove ${photos} from Favorites`}
          </ContextMenuItem>
        </ContextMenuGroup>
```

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: PASS.
Run: `pnpm --filter @lumio/web lint`
Expected: PASS (no rules-of-hooks violations — hooks are called before the early return).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/photo-grid/photo-context-menu.tsx
git commit -m "feat(context-menu): favorite / remove-from-favorites item with smart toggle"
```

---

## Task 8: Grid tile hover heart (persistent when favorited)

**Files:**
- Create: `apps/web/src/components/photo-grid/favorite-heart.tsx`
- Modify: `apps/web/src/components/photo-grid/photo-grid-tile.tsx:1-11, 50, 70-96`

- [ ] **Step 1: Create the heart button component**

Create `apps/web/src/components/photo-grid/favorite-heart.tsx`:
```tsx
"use client";

import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Bottom-left heart overlay on a grid tile. Persistent (filled) when the photo
 * is favorited; a faint outline that appears on tile hover when it isn't. Clicks
 * toggle favorite for this one photo and never select/open the tile.
 */
export function FavoriteHeart({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={active ? "Remove from Favorites" : "Add to Favorites"}
      aria-pressed={active}
      title={active ? "Remove from Favorites" : "Add to Favorites"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        "absolute bottom-1.5 left-1.5 z-20 flex size-7 items-center justify-center rounded-full text-white",
        "drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)] transition-[opacity,transform] hover:scale-110",
        active ? "opacity-100" : "opacity-0 group-hover/cell:opacity-100",
      )}
    >
      <Heart className="size-4" fill={active ? "currentColor" : "none"} strokeWidth={2} aria-hidden />
    </button>
  );
}
```

- [ ] **Step 2: Render the heart in the tile**

In `apps/web/src/components/photo-grid/photo-grid-tile.tsx`, add the imports:
```ts
import { cellVariants } from "./cell-variants";
import { FavoriteHeart } from "./favorite-heart";
import { PhotoContextMenu } from "./photo-context-menu";
import { PhotoThumb } from "./photo-thumb";
import { SelectionRing } from "./selection-ring";
import { usePhotoActionsContext } from "@/components/photo-actions/photo-actions-context";
```
Inside the component body, after `const thumb = <PhotoThumb photo={photo} mode={mode} />;` (line 50), read the actions context:
```ts
  const actions = usePhotoActionsContext();
```
Add `group/cell` to the `<a>` className (the heart's `group-hover/cell` hook lives here, distinct from PhotoThumb's inner `group/tile`):
```tsx
        className={cn(cellVariants({ mode }), "group/cell select-none", labelHex && "label-mat")}
```
Render the heart between `{thumb}` and the selection ring:
```tsx
        {thumb}
        {actions && (
          <FavoriteHeart
            active={photo.isFavorite}
            onToggle={() => void actions.favorite([photo.id], !photo.isFavorite)}
          />
        )}
        {isSelected && <SelectionRing />}
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: PASS.
Run: `pnpm --filter @lumio/web lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/photo-grid/favorite-heart.tsx apps/web/src/components/photo-grid/photo-grid-tile.tsx
git commit -m "feat(grid): hover/persistent favorite heart on tiles"
```

---

## Task 9: Toolbar favorite button + wire into the Library view

**Files:**
- Create: `apps/web/src/components/photo-actions/favorite-button.tsx`
- Modify: `apps/web/src/app/(app)/photos/library-view.tsx:1-23, 42-74`

- [ ] **Step 1: Create the toolbar button component**

Create `apps/web/src/components/photo-actions/favorite-button.tsx`:
```tsx
"use client";

import { Heart, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Outline icon button for the selection toolbar that toggles favorite over the
 * current selection. The parent computes the smart-toggle target and supplies
 * `onClick`; this stays pure UI like ColorLabelMenu.
 */
export function FavoriteButton({
  disabled,
  pending,
  onClick,
}: {
  disabled: boolean;
  pending: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="icon-sm"
      disabled={disabled}
      onClick={onClick}
      aria-label="Favorite"
      title="Favorite"
    >
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Heart aria-hidden />}
    </Button>
  );
}
```

- [ ] **Step 2: Wire it into the Library toolbar**

In `apps/web/src/app/(app)/photos/library-view.tsx`, add imports:
```ts
import { computeFavoriteTarget } from "@lumio/shared";
import { FavoriteButton } from "@/components/photo-actions/favorite-button";
```
Add the button as the first entry in the `SelectionToolbar` `actions` fragment (before `<ColorLabelMenu .../>`):
```tsx
          actions={
            <>
              <FavoriteButton
                disabled={sel.count === 0 || actions.pending.favorite}
                pending={actions.pending.favorite}
                onClick={() => {
                  const target = computeFavoriteTarget(gridRef.current?.getPhotos(sel.selected) ?? []);
                  void actions.favorite([...sel.selected], target);
                }}
              />
              <ColorLabelMenu
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: PASS.
Run: `pnpm --filter @lumio/web lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/photo-actions/favorite-button.tsx apps/web/src/app/(app)/photos/library-view.tsx
git commit -m "feat(toolbar): favorite button (smart toggle) in the Library selection toolbar"
```

---

## Task 10: Lightbox sidebar — favorite toggle

**Files:**
- Modify: `apps/web/src/components/photo-grid/lightbox-sidebar.tsx:1-23, 49-68, 103-119`

- [ ] **Step 1: Imports + destructure `patchPhotos`**

In `apps/web/src/components/photo-grid/lightbox-sidebar.tsx`, add `Heart` to the lucide import:
```ts
import { Download, Heart, Search } from "lucide-react";
```
Destructure `patchPhotos` alongside `removePhotos`:
```ts
  const { removePhotos, patchPhotos } = usePhotoCollection();
```

- [ ] **Step 2: Add the toggle handler**

After the `trash()` function (before the `return`), add:
```ts
  async function toggleFavorite() {
    const next = !photo.isFavorite;
    const res = await fetch("/api/photos/favorite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ photoIds: [photo.id], isFavorite: next }),
    });
    if (!res.ok) {
      toast.error("Failed to update favorites.");
      return;
    }
    patchPhotos(new Set([photo.id]), { isFavorite: next });
  }
```

- [ ] **Step 3: Add the button above Download**

In the actions `<div className="space-y-2">` block, add as the first button (before the Download `<Button asChild ...>`):
```tsx
          <div className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => void toggleFavorite()}
            >
              <Heart fill={photo.isFavorite ? "currentColor" : "none"} aria-hidden />
              {photo.isFavorite ? "Favorited" : "Favorite"}
            </Button>
            <Button asChild variant="outline" size="sm" className="w-full">
```

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: PASS.
Run: `pnpm --filter @lumio/web lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/photo-grid/lightbox-sidebar.tsx
git commit -m "feat(lightbox): favorite toggle in the photo detail sidebar"
```

---

## Task 11: Sidebar nav — Favorites link

**Files:**
- Modify: `apps/web/src/components/app-sidebar.tsx:5, 11-16`

- [ ] **Step 1: Add the nav item**

In `apps/web/src/components/app-sidebar.tsx`, add `Heart` to the lucide import:
```ts
import { ArrowLeft, Heart, Images, GalleryVerticalEnd, ImageUp, Search } from "lucide-react";
```
Add a Favorites entry to `PRIMARY`, after Albums:
```ts
const PRIMARY: NavItem[] = [
  { href: "/photos", label: "Photos", icon: Images, match: ["/photos", "/photo"] },
  { href: "/search", label: "Search", icon: Search, match: ["/search"] },
  { href: "/albums", label: "Albums", icon: GalleryVerticalEnd, match: ["/albums"] },
  { href: "/favorites", label: "Favorites", icon: Heart, match: ["/favorites"] },
  { href: "/upload", label: "Upload", icon: ImageUp, match: ["/upload"] },
];
```
No flyout: the existing `PRIMARY.map(...)` only special-cases `/albums`; `/favorites` falls through to a plain `NavLink`. No other change needed.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/app-sidebar.tsx
git commit -m "feat(sidebar): Favorites nav link"
```

---

## Task 12: `/favorites` page + view

**Files:**
- Create: `apps/web/src/app/(app)/favorites/page.tsx`
- Create: `apps/web/src/app/(app)/favorites/favorites-view.tsx`

- [ ] **Step 1: Create the page**

Create `apps/web/src/app/(app)/favorites/page.tsx` (mirrors `photos/page.tsx`):
```tsx
import { FavoritesView } from "./favorites-view";

export default function FavoritesPage() {
  return (
    <main className="w-full px-6 pb-6">
      <FavoritesView />
    </main>
  );
}
```

- [ ] **Step 2: Create the view**

Create `apps/web/src/app/(app)/favorites/favorites-view.tsx`. It mirrors `LibraryView` but: titled "Favorites", filters with `favorite=true`, sets `dropOnUnfavorite`, clears selection after a bulk favorite (since unfavoriting removes tiles), drops the calendar, and uses a heart empty state:
```tsx
"use client";

import { useRef } from "react";
import { Download, Heart, Loader2, Trash2 } from "lucide-react";
import { computeFavoriteTarget } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useGridSelection } from "@/lib/use-grid-selection";
import { useGridView } from "@/lib/use-grid-view";
import { useGridColumns } from "@/lib/use-grid-columns";
import { useGridSort } from "@/lib/use-grid-sort";
import { GridViewMenu } from "@/components/grid-view-menu";
import { GridSizeMenu } from "@/components/grid-size-menu";
import { GridSortMenu } from "@/components/grid-sort-menu";
import { PhotoGrid, type PhotoGridHandle } from "@/components/photo-grid/photo-grid";
import { PhotoCollectionProvider } from "@/components/photo-grid/photo-collection";
import { Lightbox } from "@/components/photo-grid/lightbox";
import { photoHref } from "@/lib/photo-href";
import { SelectionToolbar } from "@/app/(app)/photos/selection-toolbar";
import { ColorLabelMenu } from "@/components/photo-actions/color-label-menu";
import { AddToAlbumMenu } from "@/components/photo-actions/add-to-album-menu";
import { FavoriteButton } from "@/components/photo-actions/favorite-button";
import { HeaderBar } from "@/components/header-bar";
import { usePhotoActions } from "@/components/photo-actions/use-photo-actions";
import { PhotoActionsProvider } from "@/components/photo-actions/photo-actions-context";

const FAVORITES_EMPTY = (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <Heart />
      </EmptyMedia>
      <EmptyTitle>No favorites yet</EmptyTitle>
      <EmptyDescription>
        Tap the heart on a photo to add it to your favorites.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
);

export function FavoritesView() {
  const sel = useGridSelection();
  const { mode, setMode } = useGridView();
  const { columns, setColumns } = useGridColumns();
  const { sort, setSort } = useGridSort();
  const gridRef = useRef<PhotoGridHandle>(null);
  const actions = usePhotoActions({ gridRef, dropOnUnfavorite: true });

  return (
    <>
      {actions.element}
      {sel.count > 0 ? (
        <SelectionToolbar
          title="Select photos"
          count={sel.count}
          onCancel={sel.clear}
          actions={
            <>
              <FavoriteButton
                disabled={sel.count === 0 || actions.pending.favorite}
                pending={actions.pending.favorite}
                onClick={() => {
                  const target = computeFavoriteTarget(gridRef.current?.getPhotos(sel.selected) ?? []);
                  void actions.favorite([...sel.selected], target, { onSuccess: sel.clear });
                }}
              />
              <ColorLabelMenu
                disabled={sel.count === 0 || actions.pending.label}
                onPick={(label) => void actions.applyLabel([...sel.selected], label)}
              />
              <AddToAlbumMenu
                disabled={sel.count === 0}
                excludeAlbumId={actions.excludeAlbumId}
                onPick={(albumId) => void actions.addToAlbumDirect([...sel.selected], albumId)}
                onCreateNew={() => actions.addToAlbum([...sel.selected])}
              />
              <Button
                variant="outline"
                size="icon-sm"
                disabled={sel.count === 0 || actions.pending.download}
                onClick={() => void actions.download([...sel.selected], { onSuccess: sel.clear })}
                aria-label="Download"
                title="Download"
              >
                {actions.pending.download ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
              </Button>
              <Button
                variant="destructive"
                size="icon-sm"
                disabled={sel.count === 0 || actions.pending.trash}
                onClick={() => void actions.trash([...sel.selected], { onSuccess: sel.clear })}
                aria-label="Delete"
                title="Delete"
              >
                {actions.pending.trash ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
              </Button>
            </>
          }
        />
      ) : (
        <HeaderBar
          title="Favorites"
          actions={
            <>
              <GridViewMenu mode={mode} onModeChange={setMode} />
              <GridSizeMenu columns={columns} onColumnsChange={setColumns} />
              <GridSortMenu sort={sort} onSortChange={setSort} />
            </>
          }
        />
      )}

      <PhotoCollectionProvider
        key={`fav:${sort}`}
        endpoint="/api/photos"
        params={new URLSearchParams({ sort, favorite: "true" })}
        urlForId={(id) => photoHref(id, undefined, sort)}
        baseUrl="/favorites"
      >
        <PhotoActionsProvider value={actions}>
          <PhotoGrid
            apiRef={gridRef}
            mode={mode}
            columns={columns}
            selectedIds={sel.selected}
            onSelectionChange={sel.setSelected}
            empty={FAVORITES_EMPTY}
          />
          <Lightbox />
        </PhotoActionsProvider>
      </PhotoCollectionProvider>
    </>
  );
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: PASS.
Run: `pnpm --filter @lumio/web lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/(app)/favorites
git commit -m "feat(favorites): /favorites page and view"
```

---

## Task 13: Parity — favorite button in the Album and Search toolbars

The shared context menu and hover heart already cover these grids; this adds the bulk-toolbar button for parity.

**Files:**
- Modify: `apps/web/src/app/(app)/albums/[id]/album-view.tsx:1-31, 109-116`
- Modify: `apps/web/src/app/(app)/search/search-view.tsx:1-26, 142-153`

- [ ] **Step 1: Album view**

In `apps/web/src/app/(app)/albums/[id]/album-view.tsx`, add imports:
```ts
import { computeFavoriteTarget } from "@lumio/shared";
import { FavoriteButton } from "@/components/photo-actions/favorite-button";
```
Add the button as the first entry in the `SelectionToolbar` `actions` fragment (before `<AddToAlbumMenu ...>`):
```tsx
          actions={
            <>
              <FavoriteButton
                disabled={sel.count === 0 || actions.pending.favorite}
                pending={actions.pending.favorite}
                onClick={() => {
                  const target = computeFavoriteTarget(gridRef.current?.getPhotos(sel.selected) ?? []);
                  void actions.favorite([...sel.selected], target);
                }}
              />
              <AddToAlbumMenu
```

- [ ] **Step 2: Search view**

In `apps/web/src/app/(app)/search/search-view.tsx`, add imports:
```ts
import { computeFavoriteTarget } from "@lumio/shared";
import { FavoriteButton } from "@/components/photo-actions/favorite-button";
```
Add the button as the first entry in the selection-mode fragment (before `<ColorLabelMenu ...>` at line ~144):
```tsx
                    <>
                      <FavoriteButton
                        disabled={sel.count === 0 || actions.pending.favorite}
                        pending={actions.pending.favorite}
                        onClick={() => {
                          const target = computeFavoriteTarget(gridRef.current?.getPhotos(sel.selected) ?? []);
                          void actions.favorite([...sel.selected], target);
                        }}
                      />
                      <ColorLabelMenu
```

- [ ] **Step 3: Typecheck + lint + full test sweep**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: PASS.
Run: `pnpm --filter @lumio/web lint`
Expected: PASS.
Run: `pnpm -r test`
Expected: PASS across all packages.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/(app)/albums/[id]/album-view.tsx apps/web/src/app/(app)/search/search-view.tsx
git commit -m "feat(toolbar): favorite button in Album and Search selection toolbars"
```

---

## Final manual verification (browser)

Start the app (`pnpm db:up` then `pnpm dev`) and confirm:

1. **Grid hover heart** — hovering a non-favorited tile shows a faint outline heart bottom-left; clicking it fills the heart (and does NOT select/open the tile). Reload → still filled (persisted).
2. **Persistent badge** — favorited photos show a filled heart at rest while scrolling `/photos`.
3. **Toolbar (bulk)** — select several photos; the toolbar heart favorites all; selecting an all-favorited set and pressing it again unfavorites all (smart toggle). Hearts update in place.
4. **Context menu** — right-click a photo (or a selection): the item reads "Favorite N photos" / "Remove N from Favorites" and toggles correctly.
5. **Lightbox** — open a photo; the sidebar shows Favorite/Favorited and toggling updates the grid behind it.
6. **Sidebar** — a Favorites entry (heart icon) is present and routes to `/favorites`.
7. **/favorites page** — lists only favorited photos with a "Favorites" header; unfavoriting a tile (hover heart / context menu / toolbar) removes it from this grid immediately; empty state reads "No favorites yet" when none.
8. **Trash** — no favorite heart or menu item appears (no actions provider there).
