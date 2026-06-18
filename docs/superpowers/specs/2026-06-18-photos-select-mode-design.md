# Photos Select Mode — Design

**Date:** 2026-06-18
**Status:** Approved (pending spec review)

## Goal

Add a select mode to the photo grid, available on **two** pages:

- **`/photos` ("Library"):** a header with a **Select** action. In select mode the user picks photos
  (tap to toggle, shift-click for ranges) and **adds them to an album** — an existing manual album or
  a brand-new album created from the selection.
- **`/albums/[id]` (album detail):** the *same* select mode, with two bulk actions — **Add to album**
  (a photo can belong to multiple albums, so adding the selection to *another* album is useful) and
  **Remove from album** (drop the selected photos from the current album).

The selection mechanics are built as **reusable** pieces so both pages — and any future consumer —
share one implementation; only the per-page *actions* differ.

## Non-goals (YAGNI)

- Bulk **delete from the library** (removing the underlying photo) — only album add/remove.
- **Select all** — the grid is virtualized/paginated, so a true "all photos" select would need a new
  backend call. Manual + shift-range selection only.

## Title

`/photos` header title is **"Library."** It's the established term in consumer photo apps (Apple
Photos' main view; Lightroom's organize module). The sidebar nav already says "Photos," so a natural
alternative word reads better than repeating "Photos." ("Catalog" reads as database/Lightroom jargon.)

## UX

### Header (contextual toolbar)
Both pages use the albums-header layout (`flex items-center justify-between`, `text-2xl font-semibold`
title). The header *becomes* the toolbar in select mode — no separate floating action bar.

**`/photos`:**
- Normal: `Library` (left) · `Select` button, outline (right).
- Select: `{n} selected` / "Select photos" at 0 (left) · `Cancel` ghost + `Add to album` primary,
  disabled until ≥1 selected (right).

**`/albums/[id]`:**
- Normal: `{album.name}` (left) · `Select` button + existing `Delete` button (right).
- Select: `{n} selected` (left) · `Cancel` ghost + `Add to album` + `Remove from album`
  (destructive), both disabled until ≥1 selected (right).
- **Smart albums:** membership is rule-based, so `Remove from album` is **not shown** (only
  `Add to album`). The service still rejects smart-album removal defensively.

### Tiles in select mode
- Tiles render as `<button>` (not `<Link>`); clicking toggles selection instead of navigating.
- A check-circle overlay (empty → filled) sits on each tile; selected tiles also get a ring + slight
  inset/scale so selection is obvious at a glance.
- **Shift-click** selects the contiguous range from the last plain-clicked tile (the "anchor") to the
  shift-clicked tile, additively. A plain click toggles a single tile and resets the anchor.

### Add to album flow
The `Add to album` button opens a dialog (modeled on `NewAlbumDialog`) listing **manual albums only**
(smart albums reject additions). When opened from inside an album, the **current album is excluded**
from the list. Two paths:

- **Existing album:** pick from the list → selected photo IDs are added → dialog closes, selection
  clears, select mode exits.
- **New album from selection:** a "New album from selection" row at the top takes a name →
  `POST /api/albums {name, isSmart:false}` → then add the selected photo IDs to the returned album.

Adds are idempotent (the service upserts / skips duplicates), so re-adding a present photo is a no-op.
Because adding to *another* album doesn't change the current album's contents, the album grid is **not**
reloaded after an add.

### Remove from album flow (album page only)
`Remove from album` confirms with a native `confirm("Remove N photos from this album?")` (matching
`DeleteAlbumButton`), then `DELETE /api/albums/[id]/photos { photoIds }`. On success the removed
photos must disappear from the grid, so the album view **forces a grid reload** (see Architecture).
Removing only detaches the photo from this album; the photo and its other album memberships are intact.

## Architecture

Reusable mechanics + per-page view components. Only the actions are page-specific.

### Reusable (shared by both pages)

1. **`PhotoGrid` select props** (`apps/web/src/app/(app)/photos/photo-grid.tsx`)
   New optional props: `selectable?: boolean`, `selectMode?: boolean`,
   `selectedIds?: Set<string>`, `onSelectionChange?: (ids: Set<string>) => void`.
   - When unset (default), behavior is **unchanged**: tiles are `<Link>`s to `/photo/[id]`.
   - In select mode, tiles are `<button>`s with the check overlay. PhotoGrid owns the ordered
     `photos` array, so range resolution lives here via an `anchorIndex` ref.
   - A reload of the grid is achieved by changing the React `key` of the `<PhotoGrid>` element from
     the parent (remount → refetch from the first page). Used by the album page after a remove.

2. **`computeSelection(...)` pure helper** (new, `apps/web/src/lib/grid-selection.ts`)
   `computeSelection(current, photoIds, index, shiftKey, anchorIndex): Set<string>`. Pure →
   unit-testable. Handles single toggle vs. additive shift-range.

3. **`useGridSelection()` hook** (new, `apps/web/src/lib/use-grid-selection.ts`)
   Owns `selectMode` and `selected: Set<string>`; exposes `enter()`, `cancel()` (exit + clear),
   `clear()`, `setSelected`, and `count`. Page-agnostic.

4. **`SelectionToolbar`** (new, `apps/web/src/app/(app)/photos/selection-toolbar.tsx`)
   Renders the header row: title or `{n} selected`, a `Cancel` button, and an **`actions` slot**
   (`React.ReactNode`) for page-specific buttons.

5. **`AddToAlbumDialog`** (new, `apps/web/src/app/(app)/photos/add-to-album-dialog.tsx`)
   Reusable on both pages. Props: `open`, `onOpenChange`, `photoIds: string[]`, `onAdded()`,
   `excludeAlbumId?: string`. Fetches `GET /api/albums`, filters `!isSmart` and out `excludeAlbumId`,
   renders the new-album row + manual album list, performs the add.

### Per-page view components

6. **`LibraryView`** (new client, `apps/web/src/app/(app)/photos/library-view.tsx`)
   `/photos/page.tsx` becomes a thin server component rendering `<LibraryView />`. Wires
   `useGridSelection` + `SelectionToolbar` (actions: `Add to album`) + `PhotoGrid`
   (`endpoint="/api/photos"`) + `AddToAlbumDialog`.

7. **`AlbumView`** (new client, `apps/web/src/app/(app)/albums/[id]/album-view.tsx`)
   The album page's header + grid move here. `/albums/[id]/page.tsx` stays a server component that
   fetches the album and renders `<AlbumView albumId albumName isSmart />`. Wires `useGridSelection`
   + `SelectionToolbar` (actions: `Add to album` + `Remove from album`, the latter hidden when
   `isSmart`) + `PhotoGrid` (`endpoint=/api/albums/[id]/photos`, keyed for reload) + `AddToAlbumDialog`
   (`excludeAlbumId={albumId}`). Owns the remove handler and a `reloadKey` state bumped after removal.
   `DeleteAlbumButton` and the album empty-state JSX move into this component's normal-mode header.

`LibraryView` and `AlbumView` are thin compositions over pieces 1–5; they differ only in title source,
endpoint, action set, and (for the album) the Delete button + remove/reload behavior. If a third
consumer appears, extract a generic wrapper — not yet (YAGNI).

### Backend — batch add & batch remove

- **Add — `POST /api/albums/[id]/photos`** accepts `{ photoIds: string[] }` (min 1) instead of single
  `{ photoId }`. No existing UI consumer of the single contract, so switching it is low-churn.
  Service: `addPhotosToAlbum(albumId, photoIds)` — one smart-album check, then idempotent
  `createMany({ skipDuplicates: true })`. Returns `{ status: "added", count }`.
- **Remove — `DELETE /api/albums/[id]/photos`** (collection route) accepts `{ photoIds: string[] }`
  (min 1). Service: `removePhotosFromAlbum(albumId, photoIds)` → `deleteMany({ albumId,
  photoId: { in } })`, rejecting smart albums with `SmartAlbumMutationError`. Returns
  `{ status: "removed", count }`. The existing single-photo `DELETE .../photos/[photoId]` route stays.
- **Shared schema** (`packages/shared`): a batch schema (`photoIds: string[]`, min 1) reused by both
  routes.

## Data flow

```
LibraryView (/photos)                         AlbumView (/albums/[id])
  useGridSelection()                            useGridSelection()
  SelectionToolbar                              SelectionToolbar
    actions: [Add to album]                       actions: [Add to album, Remove from album*]
  PhotoGrid(endpoint=/api/photos, select…)      PhotoGrid(key=reloadKey, endpoint=/api/albums/[id]/photos, select…)
  AddToAlbumDialog(photoIds)                    AddToAlbumDialog(photoIds, excludeAlbumId=albumId)
                                                remove → confirm() → DELETE {photoIds} → bump reloadKey
  * Remove hidden when album.isSmart

Add to existing : POST /api/albums/[id]/photos { photoIds }
Add to new      : POST /api/albums {name} → POST /api/albums/[newId]/photos { photoIds }
Remove          : DELETE /api/albums/[id]/photos { photoIds }
```

## Error handling

- **Add fails** (network / 4xx): dialog shows an inline error (like `NewAlbumDialog`); selection is
  preserved for retry; select mode does not exit.
- **Remove fails:** surface an error (inline or toast); selection preserved; grid not reloaded.
- **Smart album:** excluded from the add list and the `Remove` action is hidden; the service still
  rejects both defensively (`SmartAlbumMutationError` → 400).
- **Album list fetch fails:** dialog shows a retry affordance.
- **Empty new-album name:** create button disabled (mirrors `NewAlbumDialog`).

## Testing

- **Unit — `computeSelection`**: single toggle on/off; shift-range with an anchor; shift with no
  anchor (falls back to single toggle); range spanning both directions.
- **Unit — `addPhotosToAlbum`**: batch insert; idempotency (re-adding existing); smart-album
  rejection; unknown album → `AlbumNotFoundError`.
- **Unit — `removePhotosFromAlbum`**: batch delete; removing absent photos is a no-op; smart-album
  rejection.
- **Schema**: batch schema accepts ≥1 id, rejects empty array.
- **Browser-verify**: enter/exit select mode on both pages; single toggle; shift-range; add to
  existing album; new-album-from-selection; add-from-inside-an-album (current album excluded);
  remove-from-album reloads the grid; smart album hides Remove; that a non-select grid is unchanged.
