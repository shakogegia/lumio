# Photos Select Mode — Design

**Date:** 2026-06-18
**Status:** Approved (pending spec review)

## Goal

Add a header to `/photos` (matching the albums-page header), titled **"Library"**, with a
**Select** action that puts the grid into a multi-select mode. In select mode the user picks
photos (tap to toggle, shift-click for ranges) and adds them to an album — either an existing
manual album or a brand-new album created from the selection.

The selection mechanics must be **reusable** so the album detail page can later adopt select
mode with a different bulk action (e.g. "Remove from album") without re-implementing anything.

## Non-goals (YAGNI)

- Bulk **delete** from the library — only "Add to album" for now.
- **Select all** — the grid is virtualized/paginated, so a true "all photos" select would need a
  new backend call. Manual + shift-range selection only.
- Building the album-page select mode now — only structuring so it drops in later.

## Title

**"Library."** It's the established term in consumer photo apps (Apple Photos' main view; Lightroom's
organize module). The sidebar nav already says "Photos," so a natural alternative word for the page
header reads better than repeating "Photos." ("Catalog" reads as database/Lightroom-internal jargon.)

## UX

### Header (contextual toolbar)
Matches the albums header: `flex items-center justify-between`, `text-2xl font-semibold` title.

- **Normal mode:** `Library` (left) · `Select` button, outline (right).
- **Select mode:** `{n} selected` — or "Select photos" at 0 — (left) · `Cancel` ghost button +
  `Add to album` primary button, disabled until ≥1 selected (right).

No separate floating action bar; the header *becomes* the toolbar, consistent with the albums page.

### Tiles in select mode
- Tiles render as `<button>` (not `<Link>`); clicking toggles selection instead of navigating.
- A check-circle overlay (empty → filled) sits on each tile; selected tiles also get a ring + slight
  inset/scale so selection is obvious at a glance.
- **Shift-click** selects the contiguous range from the last plain-clicked tile (the "anchor") to the
  shift-clicked tile, additively. A plain click toggles a single tile and resets the anchor.

### Add to album flow
The `Add to album` button opens a dialog (modeled on `NewAlbumDialog`) that lists **manual albums
only** (smart albums reject manual additions). Two paths:

- **Existing album:** pick from the list → selected photo IDs are added → dialog closes, selection
  clears, select mode exits.
- **New album from selection:** a "New album from selection" row at the top takes a name →
  `POST /api/albums {name, isSmart:false}` → then add the selected photo IDs to the returned album.

Adds are idempotent (the service upserts), so re-adding an already-present photo is a safe no-op.

## Architecture

Four reusable pieces + one page-specific action. Only the action is `/photos`-specific.

### Reusable (used by `/photos` now, album page later)

1. **`PhotoGrid` select props** (`apps/web/src/app/(app)/photos/photo-grid.tsx`)
   New optional props: `selectable?: boolean`, `selectMode?: boolean`,
   `selectedIds?: Set<string>`, `onSelectionChange?: (ids: Set<string>) => void`.
   - When unset (the default — and how the **album detail page renders it today**), behavior is
     **unchanged**: tiles are `<Link>`s to `/photo/[id]`.
   - When in select mode, tiles are `<button>`s with the check overlay; clicking calls into the
     selection logic. PhotoGrid owns the ordered `photos` array, so range resolution lives here via
     an `anchorIndex` ref.

2. **`computeSelection(...)` pure helper** (new, e.g. `apps/web/src/lib/grid-selection.ts`)
   `computeSelection(current: Set<string>, photoIds: string[], index: number, shiftKey: boolean,
   anchorIndex: number | null): Set<string>`. Pure → unit-testable in isolation. Handles single
   toggle vs. additive shift-range.

3. **`useGridSelection()` hook** (new, e.g. `apps/web/src/lib/use-grid-selection.ts`)
   Owns `selectMode: boolean` and `selected: Set<string>`; exposes `enter()`, `cancel()` (exit +
   clear), `clear()`, `setSelected`, and `count`. Page-agnostic.

4. **`SelectionToolbar`** (new, e.g. `apps/web/src/app/(app)/photos/selection-toolbar.tsx` or a
   shared location)
   Renders the header row: title or `{n} selected`, a `Cancel` button, and an **`actions` slot**
   (`React.ReactNode`) for page-specific buttons. `/photos` passes the "Add to album" button;
   the album page can later pass "Remove from album".

### Page-specific (`/photos`)

5. **`LibraryView`** (new client component, `apps/web/src/app/(app)/photos/library-view.tsx`)
   Wires the hook + toolbar + grid + dialog together. `/photos/page.tsx` stays a thin server
   component rendering `<LibraryView />`.

6. **`AddToAlbumDialog`** (new client component, `apps/web/src/app/(app)/photos/add-to-album-dialog.tsx`)
   Props: `open`, `onOpenChange`, `photoIds: string[]`, `onAdded()`. Fetches `GET /api/albums`,
   filters `!isSmart`, renders the new-album row + manual album list, performs the add.

### Backend — batch add

Extend the existing endpoint rather than fanning out N requests client-side:

- **`POST /api/albums/[id]/photos`** accepts `{ photoIds: string[] }` (min 1) instead of a single
  `{ photoId }`. There is **no existing UI consumer** of the single-photo contract, so switching it
  is low-churn.
- **Shared schema** (`packages/shared`): replace/extend `addPhotoSchema` with a batch schema
  (`photoIds: string[]`, min 1).
- **Service** (`apps/web/src/lib/albums-service.ts`): add
  `addPhotosToAlbum(albumId, photoIds: string[])` — one smart-album check, then an idempotent
  `createMany({ skipDuplicates: true })` (or upsert loop in a transaction). Returns the count added.
- **Response:** `{ status: "added", count }`.

Existing single-photo callers/tests are updated to the batch shape.

## Data flow

```
LibraryView (client)
  ├─ useGridSelection() → { selectMode, selected, enter, cancel, setSelected, count }
  ├─ SelectionToolbar (title/count, Cancel, actions slot)
  │     └─ actions: <Button onClick={openDialog}>Add to album</Button>
  ├─ PhotoGrid (endpoint="/api/photos", selectable, selectMode, selectedIds=selected,
  │     onSelectionChange=setSelected)
  │     └─ tile click → computeSelection(...) → onSelectionChange(next)
  └─ AddToAlbumDialog (photoIds=[...selected], onAdded → cancel())
        ├─ existing album → POST /api/albums/[id]/photos { photoIds }
        └─ new album    → POST /api/albums {name} → POST /api/albums/[newId]/photos { photoIds }
```

## Error handling

- **Add fails** (network / 4xx): dialog shows an inline error (same pattern as `NewAlbumDialog`),
  selection is preserved so the user can retry. Select mode does not exit on failure.
- **Smart album**: excluded from the list, so it can't be chosen. The service still rejects it
  defensively (`SmartAlbumMutationError` → 400).
- **Album list fetch fails**: dialog shows a retry affordance.
- **Empty new-album name**: create button disabled (mirrors `NewAlbumDialog`).

## Testing

- **Unit — `computeSelection`**: single toggle on/off, shift-range with an anchor, shift with no
  anchor (falls back to single toggle), range spanning both directions.
- **Unit — `addPhotosToAlbum`**: batch insert, idempotency (re-adding existing), smart-album
  rejection, unknown album → `AlbumNotFoundError`.
- **Schema**: batch schema accepts ≥1 id, rejects empty array.
- **Browser-verify**: enter/exit select mode, single toggle, shift-range, add to existing album,
  new-album-from-selection, that the album detail page (no select props) is unchanged.

## Reuse note (album page, later)

Adopting select mode on `/albums/[id]` later means: call `useGridSelection()`, render
`SelectionToolbar` with a "Remove from album" action, and pass the select props to the existing
`PhotoGrid`. The reusable pieces (1–4 above) need no changes; only a new
`RemoveFromAlbum`-style action component and the `removePhotoFromAlbum` service (already exists,
would get a batch variant) are added.
