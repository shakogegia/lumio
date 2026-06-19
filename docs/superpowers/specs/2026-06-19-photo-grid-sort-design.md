# Photo grid sort — design

## Summary

Add a sort control to the photo grid toolbar so users can order photos by **date
taken** or **date imported**, newest- or oldest-first. The control appears
wherever the photo grid is shown — Library, Albums, Search — but **not in Trash**,
which keeps its fixed delete-date ordering. The chosen sort threads end-to-end:
it reorders the grid listing *and* the photo detail view's prev/next + film-strip
navigation, so opening a photo always walks the same sequence the grid showed.

## Goals

- A toolbar dropdown offering four orderings: Date taken (newest/oldest) and
  Date imported (newest/oldest).
- Default ordering is unchanged from today (newest taken-date first).
- The choice is global (one setting across Library, Albums, Search) and persists
  across routes and reloads.
- Grid order and detail-view navigation order stay in lockstep for every sort.

## Non-goals (YAGNI)

- No sort control in Trash; Trash stays `deletedAt desc`.
- No separate ascending/descending toggle button — directions live in the dropdown.
- No per-view persistence (each album / search remembering its own sort).
- No new date columns; reuse the existing `sortDate` and `createdAt`.

## Sort options & semantics

A single dropdown, one enum value per choice:

| Label                       | enum value      | Order key       | Notes                                  |
| --------------------------- | --------------- | --------------- | -------------------------------------- |
| Date taken · Newest first   | `taken-desc`    | `sortDate` desc | **Default** — identical to today.      |
| Date taken · Oldest first   | `taken-asc`     | `sortDate` asc  |                                        |
| Date imported · Newest first| `imported-desc` | `createdAt` desc|                                        |
| Date imported · Oldest first| `imported-asc`  | `createdAt` asc |                                        |

**"Date taken" maps to the existing `sortDate` column.** Ingest already sets
`sortDate = takenAt ?? new Date()` (`packages/ingest/src/store.ts:35`), i.e. the
EXIF capture date with a fall-back to import time. So photos with no EXIF date
stay mixed in chronologically by their import time (the requested behaviour) for
free, and `taken-desc` is byte-for-byte the current `PHOTO_ORDER`.

**"Date imported" maps to `createdAt`** — the true ingest timestamp.

Each ordering carries an `id` tiebreaker **in the same direction** as the primary
key, so the existing keyset/cursor pagination stays monotonic:

- `taken-desc`     → `[{ sortDate: "desc" }, { id: "desc" }]`
- `taken-asc`      → `[{ sortDate: "asc" },  { id: "asc" }]`
- `imported-desc`  → `[{ createdAt: "desc" }, { id: "desc" }]`
- `imported-asc`   → `[{ createdAt: "asc" },  { id: "asc" }]`

## Architecture

### Client

**`apps/web/src/lib/use-grid-sort.ts`** (new) — a copy of the
`use-grid-columns.ts` `useSyncExternalStore` pattern:

- `localStorage` key `lumio:grid-sort`.
- `parseGridSort(stored: string | null): PhotoSort` — pure, validates against the
  four enum values, defaults to `taken-desc` for missing/invalid input.
- `useGridSort()` returns `{ sort, setSort }`, synced across tabs (the `storage`
  event) and across grids in the same tab (a local listener set), with a server
  snapshot of `taken-desc` to avoid hydration mismatch.

**`apps/web/src/components/grid-sort-menu.tsx`** (new) — mirrors
`grid-view-menu.tsx`:

- `icon-sm` outline `Button` trigger (lucide `ArrowDownUp`), `aria-label`/`title`
  "Sort".
- `DropdownMenuContent` with one `DropdownMenuRadioGroup` spanning all four items,
  visually grouped: a `DropdownMenuLabel` "Date taken" over two radio items
  ("Newest first", "Oldest first"), a `DropdownMenuSeparator`, then a
  `DropdownMenuLabel` "Date imported" over its two radio items ("Newest first",
  "Oldest first"). The active value is checked.
- Props: `{ sort: PhotoSort; onSortChange: (s: PhotoSort) => void }`.

**View wiring** — Library (`photos/library-view.tsx`), Album
(`albums/[id]/album-view.tsx`), Search (`search/search-view.tsx`):

- Call `useGridSort()` and render `<GridSortMenu>` in the `HeaderBar` actions
  alongside the existing `GridViewMenu` / `GridSizeMenu`.
- Add `sort` to the `URLSearchParams` passed to `<PhotoGrid params=...>` so the
  fetch carries it. (Search merges it into its existing `paramsFor(filters)`.)
- Pass the active `sort` down so tile hrefs carry it (see Detail-view section).
- **Include `sort` in the grid's React `key`** so changing the sort remounts the
  grid and refetches from page 1. `usePhotoPages` fetches only on mount and resets
  state only on remount (`use-photo-pages.ts:26,59-63`) — it does *not* react to a
  changed `params` object — so a `key` change is the required mechanism, the same
  one album/search already use for scope changes. Concretely:
  - Library (`library-view.tsx`): the `<PhotoGrid>` has no `key` today; add
    `key={sort}`.
  - Album (`album-view.tsx`): extend the existing `key={reloadKey}` to
    `key={`${reloadKey}:${sort}`}`.
  - Search (`search-view.tsx`): extend the existing `key={serialize(filters)}` to
    `key={`${serialize(filters)}:${sort}`}`.

Trash (`trash/trash-view.tsx`) is left as-is — no `GridSortMenu`, no `sort` param.

### Shared schema

**`packages/shared/src/api.ts`**:

```ts
export const photoSortSchema = z
  .enum(["taken-desc", "taken-asc", "imported-desc", "imported-asc"])
  .default("taken-desc");
export type PhotoSort = z.infer<typeof photoSortSchema>;
```

Add `sort: photoSortSchema` to both `photosQuerySchema` and `searchQuerySchema`.
(The Trash route reuses `photosQuerySchema`; it will parse a `sort` field but
`listTrash` ignores it — harmless, no behaviour change.)

### Server ordering

**`apps/web/src/lib/photo-order.ts`**:

- Add `photoOrderBy(sort: PhotoSort): Prisma.PhotoOrderByWithRelationInput[]`
  returning the arrays in the table above.
- Keep a `PHOTO_ORDER` export equal to `photoOrderBy("taken-desc")` for the
  album-cover query, which should stay "most recent representative" and is **not**
  user-sortable.

**Services** thread `params.sort` into `orderBy`:

- `listPhotos(params)` → `orderBy: photoOrderBy(params.sort)`.
- `listAlbumPhotos(id, params)` → same.
- `searchPhotos(params)` → same.
- `listTrash` — unchanged (`[{ deletedAt: "desc" }, { id: "desc" }]`).

### Detail-view navigation (sort reaches prev/next + film strip)

The detail view computes a photo's neighbors server-side using the grid's
ordering, and carries its navigation *scope* in the URL query
(`?album=…`, `?s=1&album=…&q=…`). Sort joins that scope:

- **`getPhotoNeighbors(current, albumId, sort, window?)`** and
  **`getNeighborsForWhere(current, where, sort, window?)`** take a `sort` argument
  and order by `photoOrderBy(sort)` (replacing the hardcoded `PHOTO_ORDER`). The
  forward page, the negative-`take` backward page, and the film-strip assembly are
  all already direction-agnostic, so they work for every ordering.
- **`photo-detail-loader.ts`**: `DetailScope` gains a `sort: PhotoSort` field on
  every variant. `parseDetailScope(sp)` reads `sp.sort` (validated via
  `photoSortSchema`, default `taken-desc`). `detailScopeQuery(scope)` re-emits
  `sort` **only when it isn't the default**, keeping URLs clean. `loadPhotoDetail`
  passes `scope.sort` into the neighbor query.
- **Entry hrefs from the grid**: `photoHref(id, albumId?, sort?)` appends
  `sort=…` (omitted when default). `PhotoGrid` gains an optional `sort?: PhotoSort`
  prop forwarded to `PhotoGridTile`, which uses it in the default
  `photoHref(photo.id, albumId, sort)`. The Search view's `hrefFor` override adds
  `sort` to its scope query the same way.
- **`photo-detail.tsx`** already builds prev/next/film-strip hrefs from the
  serialized `scope` string, so once `detailScopeQuery` includes `sort`, those
  links preserve it automatically.

### Database

One migration adding `@@index([createdAt, id])` to `Photo`, so import-date
pagination is index-backed in both directions. The existing `@@index([sortDate,
id])` already covers both taken-date directions (Postgres scans it forward or
backward).

## Data flow

```
useGridSort() ──sort──┐
                      ▼
View builds URLSearchParams{ sort, … } ──► <PhotoGrid params sort=…>
   │                                              │
   │ (tile href)                                  ▼
   ▼                                   usePhotoPages → GET /api/photos?sort=…&cursor=…
photoHref(id, albumId, sort)                       │
   │                                               ▼
   ▼                                   listPhotos({ …, sort }) → orderBy: photoOrderBy(sort)
/photo/{id}?album=…&sort=…
   │
   ▼
parseDetailScope → scope{ …, sort }
   │
   ├─► loadPhotoDetail → getPhotoNeighbors(current, albumId, sort) → photoOrderBy(sort)
   └─► detailScopeQuery(scope) → prev/next/film-strip hrefs carry sort
```

## Edge cases

- **Photos with no `takenAt`**: ordered by their import time within the taken-date
  sorts (because `sortDate` already falls back to import time). Nothing disappears.
- **Default URLs stay clean**: `sort` is omitted from hrefs and scope queries when
  it equals `taken-desc`, so existing links and the common case are unchanged.
- **Cursor validity across a sort change**: including `sort` in the grid `key`
  remounts it, so it refetches from page 1 under the new ordering and stale cursors
  from the previous ordering are never mixed in.
- **Trash**: receives no `sort` and ignores it if present; ordering unchanged.
- **Album cover thumbnails**: keep `sortDate desc` regardless of the chosen sort.

## Testing

Unit (pure functions):

- `parseGridSort` — each valid value, invalid string, `null`/empty → default.
- `photoOrderBy` — returns the correct `[{field:dir},{id:dir}]` for all four.
- `parseDetailScope` / `detailScopeQuery` — round-trip including `sort`, and the
  default-omitted-from-URL behaviour, for library/album/search scopes.

Service tests (extend existing ones that already assert `orderBy`):

- `listPhotos`, `searchPhotos`, `listAlbumPhotos` issue `photoOrderBy(sort)` for
  each sort value.
- Neighbor queries (`getPhotoNeighbors` / `getNeighborsForWhere`) order by the
  passed sort.

Following repo convention, cover pure functions and service ordering rather than
heavy component rendering.

## Files touched

New:

- `apps/web/src/lib/use-grid-sort.ts`
- `apps/web/src/components/grid-sort-menu.tsx`
- `packages/db/prisma/migrations/<timestamp>_add_created_at_index/migration.sql`

Modified:

- `packages/shared/src/api.ts` (schema + `PhotoSort`)
- `packages/db/prisma/schema.prisma` (`@@index([createdAt, id])`)
- `apps/web/src/lib/photo-order.ts` (`photoOrderBy`)
- `apps/web/src/lib/photos-service.ts` (`listPhotos`, neighbor queries)
- `apps/web/src/lib/albums-service.ts` (`listAlbumPhotos`)
- `apps/web/src/lib/search-service.ts` (`searchPhotos`)
- `apps/web/src/lib/photo-detail-loader.ts` (`DetailScope`, parse/serialize, loader)
- `apps/web/src/lib/photo-href.ts` (`sort` arg)
- `apps/web/src/components/photo-grid/photo-grid.tsx` (`sort` prop)
- `apps/web/src/components/photo-grid/photo-grid-tile.tsx` (`sort` in default href)
- `apps/web/src/app/(app)/photos/library-view.tsx`
- `apps/web/src/app/(app)/albums/[id]/album-view.tsx`
- `apps/web/src/app/(app)/search/search-view.tsx`
- `apps/web/src/app/(app)/search/filters.ts` (weave `sort` into `paramsFor` for the
  fetch and into `scopeQuery` for the detail href)
- Relevant test files alongside the above.
