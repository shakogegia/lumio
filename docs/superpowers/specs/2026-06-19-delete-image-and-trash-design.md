# Delete Image + Trash — Design

**Date:** 2026-06-19
**Status:** Approved (pending spec review)

## Goal

Let users delete photos — one at a time from the photo detail view, or many at once
via the existing grid selection mode. Deletes are **recoverable**: they move to a
**Trash** that has its own page where photos can be **restored** or **permanently
deleted**. Retention is **manual only** (no auto-purge / scheduler).

## Decisions (settled during brainstorming)

- **Recoverable trash**, not permanent delete — these are likely the user's originals.
- **Dedicated Trash page** in the sidebar with Restore / Delete permanently / Empty trash.
- **Manual retention** — trashed photos stay until explicitly purged. No background job.
- **Separate `TrashedPhoto` table** (not a `deletedAt` flag on `Photo`).

### Why a separate table, not a soft-delete flag

The filesystem watcher and every listing query key off the `Photo` table and its
**unique `path`** constraint. A `deletedAt` flag would force `where deletedAt is null`
into every query, and a lingering trashed row would block re-importing a new file at
the same `path`. A separate table keeps trash fully isolated from the live
watcher/grid logic.

## Non-goals (YAGNI)

- No auto-purge / retention scheduler.
- No per-photo detail page for trashed photos (Trash is selection-only).
- No "undo toast" — recovery is via the Trash page.
- No change to upload provenance handling (uploads aren't built yet; trash treats all
  photos uniformly via their `path`).

## Data model

New table (Prisma, `packages/db/prisma/schema.prisma`):

```prisma
model TrashedPhoto {
  id           String      @id            // reuse the original Photo id (cache files are keyed by it)
  originalPath String                     // where it lived under PHOTOS_DIR, for restore
  source       PhotoSource
  takenAt      DateTime?
  sortDate     DateTime
  width        Int
  height       Int
  hash         String?
  exif         Json
  albumIds     String[]                   // album-membership snapshot, to re-link on restore
  deletedAt    DateTime    @default(now())

  @@index([deletedAt, id])                // newest-first ordering
}
```

Reusing the original `Photo.id` as the primary key means the cache files
(`<id>.webp`) and the restored `Photo` row map back without any id remapping.

## Storage layout

New `TRASH_DIR` (default `./trash` at the repo root, sibling of `photos`/`cache`),
added to `apps/web/src/lib/paths.ts` alongside `PHOTOS_DIR`/`CACHE_DIR`. It lives
**outside** the watched `PHOTOS_DIR` so chokidar never sees it.

Per trashed photo:

- `TRASH_DIR/originals/<id><ext>` — the original file
- `TRASH_DIR/thumbnails/<id>.webp` — moved thumbnail rendition
- `TRASH_DIR/displays/<id>.webp` — moved display rendition

The renditions are moved (not regenerated) so the Trash grid renders without
re-decoding originals.

## Services + watcher coordination

The app performs the whole operation itself; it does **not** rely on the watcher.
Moving a file out of `PHOTOS_DIR` fires a chokidar `unlink` → `removePath`, so
ordering matters. (`removePath` is a no-op when no `Photo` row matches the path —
verified in `packages/ingest/src/ingest.ts`.)

### `trashPhotos(ids)` — move to trash

Per photo:

1. Read the `Photo` row + its album ids.
2. Create the `TrashedPhoto` snapshot. **Done before any row deletion**, so no race
   can lose the metadata.
3. Move cache renditions `CACHE_DIR/{thumbnails,displays}/<id>.webp` → `TRASH_DIR/...`.
4. Move the original `PHOTOS_DIR/<path>` → `TRASH_DIR/originals/<id><ext>`.
5. Delete the `Photo` row (tolerant of "already gone" — the watcher's `unlink` may
   delete it first; same end state).

### `restorePhotos(ids)` — restore from trash

Per photo:

1. Recreate the `Photo` row **with the same id**, re-linking only album ids that
   still exist.
2. Move renditions back `TRASH_DIR/...` → `CACHE_DIR/{thumbnails,displays}/<id>.webp`.
3. Move the original back to `originalPath` under `PHOTOS_DIR`.
4. Delete the `TrashedPhoto` row.

Recreating the row **before** the file lands means the watcher's subsequent `add` →
`storePhoto.upsert(by path)` **updates in place** (keeps id + album links) rather
than creating a fresh row. (`storePhoto` upserts on the unique `path` — verified in
`packages/ingest/src/store.ts`.)

### `purgeTrash(ids?)` — permanent delete / empty

`rm` the three trash files (best-effort, `force: true`) and delete the `TrashedPhoto`
rows. No watcher involvement (the files are outside the watched dir). With no `ids`,
purges all (Empty trash).

## API endpoints

All wrapped in `withAuth`, mirroring the album routes
(`apps/web/src/app/api/albums/...`).

| Method & path                | Body        | Returns           |
|------------------------------|-------------|-------------------|
| `POST /api/photos/trash`     | `{ ids }`   | `{ trashed: n }`  |
| `GET  /api/trash?cursor=`    | —           | paginated list (PhotoDTO-shaped) |
| `POST /api/trash/restore`    | `{ ids }`   | `{ restored: n }` |
| `POST /api/trash/purge`      | `{ ids }`   | `{ deleted: n }`  |
| `POST /api/trash/empty`      | —           | `{ deleted: n }`  |

Single-photo delete is just `POST /api/photos/trash` with one id.

`/api/thumbnails/[id]` gains a fallback: when the id isn't in `CACHE_DIR/thumbnails`,
serve from `TRASH_DIR/thumbnails`. This lets the Trash grid reuse the existing
`PhotoThumb` (which hardcodes `/api/thumbnails/<id>`) and `PhotoGrid` unchanged.

## UI

### Single delete — photo detail

A **Delete** button in the detail sidebar (`apps/web/src/app/(app)/photo/[id]/photo-detail.tsx`),
gated by a `window.confirm` (matching the codebase's destructive-action pattern —
`DeleteAlbumButton`, album remove-from-album). On success → `router.back()`.

### Bulk delete — grid selection

Reuse the existing selection flow (`useGridSelection` + `SelectionToolbar`, already
wired in `library-view.tsx` and `album-view.tsx`). Add a **Delete** action to the
toolbar in both views, gated by a `window.confirm` showing the selected count. On
success, remount the grid (`reloadKey`), `sel.cancel()`, and `router.refresh()`.

### Trash page

New route `apps/web/src/app/(app)/trash/` + a sidebar link in `sidebar-more.tsx`.
Reuses `PhotoGrid` (`endpoint="/api/trash"`) + `useGridSelection` + `SelectionToolbar`
with trash-specific actions:

- **Restore** (on selection)
- **Delete permanently** (on selection, with confirm)
- **Empty trash** (header button, with confirm)

Trash tiles are selection-only — they do not link to a detail page.

## Edge cases

- **Restore path occupied** (a different file now sits at `originalPath`): restore to
  a suffixed path (e.g. `name (restored).jpg`) and set `Photo.path` accordingly.
- **Album deleted while photo was trashed**: re-link only album ids that still exist.
- **Missing trash/cache files**: all `rm` and move operations are best-effort
  (`force: true`), matching `purgeAllPhotos`.

## Testing

Service-level tests, mirroring existing service/ingest tests:

- Trash → restore round-trip preserves id **and** album membership.
- Permanent delete removes files + row; Empty trash clears all.
- Restore-path-collision suffixes the path.
- Restore re-links only surviving albums.
- Watcher `unlink` during/after trash is a no-op on the (already-removed) row.
