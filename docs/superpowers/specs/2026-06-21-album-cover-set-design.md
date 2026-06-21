# Set as album cover — design

## Problem

Album covers are currently **derived**, never chosen. In `listAlbumSummaries`
(`apps/web/src/lib/albums-service.ts`) the cover is computed at read time:

- regular album → most-recent member by `sortDate desc`
- smart album → first photo by canonical order

There is no `coverPhotoId` column on `Album`. Users want to **pin** a specific
photo as an album's cover from within the album view (toolbar + right-click
context menu), with a sensible fallback when that photo later leaves the album.

## Scope & decisions

- **Regular albums only.** Smart albums have no explicit membership and already
  gate add/remove; "Set as cover" is not offered there. The derived cover keeps
  working for them.
- **Menu-only "current cover" hint.** The context menu marks the photo that is
  already the pinned cover; no persistent badge on the grid tile.
- **Multi-select:** the action is **always visible but disabled** unless exactly
  one photo is selected/targeted (it is inherently single-photo).
- **Fallback on removal:** when the pinned photo leaves the album, the effective
  cover defaults back to the derived most-recent.

## 1. Data model

Add one nullable column to `Album`:

```prisma
model Album {
  id           String       @id @default(cuid())
  name         String
  isSmart      Boolean      @default(false)
  rules        Json?
  coverPhotoId String?      // explicitly pinned cover; null = use derived default
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt
  photos       AlbumPhoto[]
}
```

Plain nullable column — **no FK relation**. Correctness comes from the read-time
membership check (§2), which also makes a stale pin harmless after photo deletion
or re-ingest without needing relation/`onDelete` wiring.

Migration: `add_album_cover_photo_id`. Recipe (DB on port 5433):

```
pnpm --filter @lumio/db migrate --name add_album_cover_photo_id
```

(`prisma migrate dev` via the package's `migrate` script, which loads `../../.env`.)

### Two meanings of `coverPhotoId` (documented in `types.ts`)

- `AlbumDTO.coverPhotoId` — the **pinned** value, raw from the row (via
  `toAlbumDTO`). Nullable. Used by the album **detail** view to render the menu
  checkmark and seed the set-cover action.
- `AlbumSummaryDTO.coverPhotoId` — the **effective** cover: pinned-if-still-a-member,
  else derived. Same field name, resolved value. Used by the album grid card
  (`album-card.tsx`) and sidebar (`sidebar-albums.tsx`) to render the thumbnail.
  Existing consumers keep working unchanged.

## 2. Read path — effective cover + fallback

In `listAlbumSummaries`, for a **regular** album:

1. If `a.coverPhotoId` is set **and** an `albumPhoto` row exists for
   `(albumId, a.coverPhotoId)`, the effective cover is `a.coverPhotoId`.
2. Otherwise fall back to the current derivation (most-recent member by
   `sortDate desc`).

This membership check is the single source of truth for "defaults to something
when removed" — a stale pin is silently ignored at read time. Smart-album branch
is unchanged.

`toAlbumDTO` is extended to surface the raw `coverPhotoId` so `getAlbum` (used by
the detail page) carries the pinned value.

## 3. Set-cover service + API

**Service** (`albums-service.ts`):

```
setAlbumCover(albumId, photoId, db = prisma): Promise<void>
```

- album missing → `AlbumNotFoundError`
- album is smart → `SmartAlbumMutationError`
- photo is not a member (`albumPhoto` row absent) → new `PhotoNotInAlbumError`
- else `db.album.update({ where: { id: albumId }, data: { coverPhotoId: photoId } })`

**API** — `PATCH /api/albums/[id]` with body `{ coverPhotoId: string }`:

- new zod schema (e.g. `setAlbumCoverSchema`) in `@lumio/shared`
- maps `AlbumNotFoundError` → 404, `SmartAlbumMutationError` /
  `PhotoNotInAlbumError` → 400, returns `{ status: "ok" }` on success.

PATCH-the-album resource is the natural REST fit and avoids adding a route file
(cover is a scalar album property, not a sub-collection).

## 4. Removal handling (prevent stale resurrection)

Read-time validation (§2) guarantees correct **display** for every removal path
(remove-from-album, trash/whole-library delete, re-ingest). On top of that,
**eager-clear the pin** in the two explicit remove-from-album service functions so
a removed-then-readded photo does not silently resurrect as the cover:

- `removePhotosFromAlbum(albumId, photoIds)` — after deleting membership, if
  `photoIds` includes the album's `coverPhotoId`, null it.
- `removePhotoFromAlbum(albumId, photoId)` — likewise for the single id.

Trash / whole-library delete is **not** specially handled (read-time check covers
its display); resurrection-after-untrash is an accepted extreme edge case.

## 5. Client UI

### `usePhotoActions` (`use-photo-actions.tsx`)

- New optional config `albumCover?: { albumId: string; coverPhotoId: string | null }`.
  Present only in the album view (regular albums); its absence is what hides the
  action in every other view.
- New action `setAlbumCover(photoId: string, opts?: ActionOpts): Promise<void>`:
  PATCH `/api/albums/{albumId}` → on success `router.refresh()` (so card, sidebar,
  and the menu hint all update) + toast "Album cover updated"; error toast on
  failure. Exposes the action and `albumCover` on the returned `PhotoActions`.

### `AlbumView` (`albums/[id]/album-view.tsx`) + page

- `page.tsx` passes `coverPhotoId={album.coverPhotoId}` (now on `AlbumDTO`) to
  `AlbumView`, which adds a `coverPhotoId` prop and, for regular albums, passes
  `albumCover={{ albumId, coverPhotoId }}` into `usePhotoActions`.
- **Toolbar** (regular albums only, alongside the existing Remove button): a
  "Set as cover" icon button — **always visible, enabled only when
  `sel.count === 1`**. On click: `setAlbumCover([...sel.selected][0])`. Keeps the
  selection on success (non-destructive, like Favorite). Icon: a cover/image glyph
  (e.g. lucide `ImageUp`), `variant="outline" size="icon-sm"`.

### `PhotoContextMenu` (`photo-grid/photo-context-menu.tsx`)

Rendered only when `actions.albumCover` is present:

- `count === 1` and target ≠ pinned cover → **"Set as album cover"** (active),
  `onSelect` → `setAlbumCover(targetIds[0])`.
- `count === 1` and target **is** the pinned cover → disabled **"Current album cover"**.
- `count > 1` → disabled **"Set as album cover"**.

Placed in the primary action group near "Add to album".

## 6. Testing

- `albums-service.test.ts`:
  - `setAlbumCover` happy path; rejects smart album; rejects non-member.
  - `listAlbumSummaries` returns the pinned cover when valid; falls back to derived
    most-recent when the pinned photo is removed from the album.
  - `removePhotosFromAlbum` / `removePhotoFromAlbum` clear the pin when it is among
    the removed ids.
- API route: thin; covered via service tests + a basic 400/404 mapping check if a
  route test file exists for albums.
- Browser-verify: in a regular album, set a cover from the toolbar (1 selected) and
  from the context menu; confirm the menu shows "Current album cover" on that photo, the
  card/sidebar thumbnail updates, the toolbar button disables at 0/2+ selected, and
  removing the cover photo reverts to the derived default.

## Out of scope / YAGNI

- Setting a cover for smart albums.
- An explicit "unset cover" action (removal + fallback already covers it).
- Persistent cover badge on grid tiles.
- Setting cover from the photo detail / lightbox view.
