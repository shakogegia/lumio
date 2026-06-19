# Search toolbar — design

**Date:** 2026-06-19
**Status:** Approved (pending spec review)

## Goal

Give the search results view the same toolbar and bulk actions the Library page
has, so a search result set is a first-class place to manage photos — not just a
read-only list with a sort dropdown.

## Current state

`apps/web/src/app/(app)/search/search-view.tsx` already reuses the shared
`PhotoGrid`, but when results are showing it renders only a single right-aligned
`GridSortMenu` above the grid (`search-view.tsx:86-89`). It has no select mode,
no grid-view/grid-size controls, and no bulk actions.

The Library page (`apps/web/src/app/(app)/photos/library-view.tsx`) is the
reference for "typical actions we have":

- **Normal mode:** `GridViewMenu` (fill/fit/card) · `GridSizeMenu` (columns) ·
  `GridSortMenu` (sort) · **Select** button.
- **Select mode:** *N selected* · `ColorLabelMenu` · **Add to album** ·
  **Download** · **Delete** · **Cancel**.

## Layout decision

Library swaps its entire sticky `HeaderBar` for `SelectionToolbar` when entering
select mode. Search **cannot** do that: its top is occupied by the sticky search
box (`sticky top-0 z-20`), which must stay visible at all times (including in
select mode). A second sticky bar pinned to the viewport top would collide with
it.

Therefore the toolbar lives in the **results-area row** — the row that today
holds only the sort menu, just beneath the search box. We build this row inline
rather than reusing the sticky `HeaderBar` / `SelectionToolbar` wrappers. The
individual controls and action buttons are all reused unchanged.

The row is only rendered when results are shown (`active && !empty`). When the
query is empty (recent searches are showing), there is no toolbar and no select
mode — unchanged from today.

### Row, normal mode

Right-aligned, mirroring Library's order:

```
[GridViewMenu] [GridSizeMenu] [GridSortMenu] [Select]
```

### Row, select mode

Left: `N selected` (or "Select photos" when count is 0). Right, mirroring
Library's action set (`library-view.tsx:111-136`):

```
[ColorLabelMenu] [Add to album] [Download] [Delete] [Cancel]
```

## Component move (refactor)

`ColorLabelMenu` and `AddToAlbumDialog` currently live in the `photos` **route**
folder (`app/(app)/photos/`) but are shared UI. To let Search use them without a
cross-route relative import, move both into a new shared folder:

- `app/(app)/photos/color-label-menu.tsx` → `components/photo-actions/color-label-menu.tsx`
- `app/(app)/photos/add-to-album-dialog.tsx` → `components/photo-actions/add-to-album-dialog.tsx`

Both files import only via `@/`-absolute paths, so no internal edits are needed
on move. Update all existing import sites:

- `app/(app)/photos/library-view.tsx` — 2 imports (`./color-label-menu`,
  `./add-to-album-dialog`) → `@/components/photo-actions/...`
- `app/(app)/albums/[id]/album-view.tsx` — 1 import
  (`@/app/(app)/photos/add-to-album-dialog`) → `@/components/photo-actions/...`

`SelectionToolbar` stays where it is — out of scope for this change.

## Wiring in `search-view.tsx` (reuse, ported from `library-view.tsx`)

Add to `SearchView`:

- `useGridSelection()` — select-mode toggle + selected-id set, with its built-in
  Escape handling (already ignores Escape while typing in the search input, so
  it won't fight the search box).
- `useGridView()` — the one grid hook Search doesn't have yet. `useGridColumns`
  and `useGridSort` are already in place.
- `useConfirm()` for the delete confirmation dialog.
- A `gridRef` (`PhotoGridHandle`) so delete/label can mutate tiles in place.
- Local `useState` flags `deleting`, `downloading`, `labelPending`, plus the
  `AddToAlbumDialog` open state — same as Library.

Ported handlers (verbatim behavior from Library):

- `handleDelete` — confirm → `POST /api/photos/trash` → `gridRef.removePhotos(ids)`
  → `sel.cancel()`. Delete moves photos to Trash app-wide (same semantics as
  Library) and removes the tiles from the current result set in place.
- `handleDownload` — `downloadSelection(ids)` → `sel.clear()` (stay in select
  mode).
- `applyLabel` — `POST /api/photos/color-label` → `gridRef.patchPhotos(...)` →
  `sel.clear()`.

`PhotoGrid` (currently `search-view.tsx:90-98`) gains the selection + view props:

```tsx
<PhotoGrid
  key={`${serialize(filters)}:${sort}`}
  apiRef={gridRef}
  mode={mode}
  columns={columns}
  sort={sort}
  endpoint="/api/search"
  params={paramsFor(filters, sort)}
  hrefFor={(id) => `/photo/${id}?${scopeQuery(filters, sort)}`}
  empty={<SearchEmpty />}
  selectMode={sel.selectMode}
  selectedIds={sel.selected}
  onSelectionChange={sel.setSelected}
/>
```

## Behavior: query change while selecting

The `PhotoGrid` already remounts when `filters` or `sort` change (its `key`
includes `serialize(filters)`), which resets the grid's internal state. But the
parent's `sel.selected` set would otherwise persist with now-stale IDs.

**Decision:** changing the active query **exits select mode and clears the
selection** (full reset), fitting the transient nature of a result set.
Implementation: a `useEffect` keyed on `serialize(filters)` calls `sel.cancel()`
when the serialized filters change. This mirrors how the `PhotoGrid` already
derives its remount `key` from `serialize(filters)`, so the toolbar resets in
lockstep with the grid. (The effect is a no-op on first render where there is no
selection to clear.)

## Out of scope

- Moving `SelectionToolbar` to `components/`.
- Any change to the search query/endpoint, recent searches, or the empty state.
- "Remove from album" (that's album-detail-only and irrelevant to search).

## Testing / verification

- Existing tests must still pass after the component move (import paths updated).
- Manual browser verification (per project workflow): run a search, confirm the
  full toolbar appears; enter select mode, exercise color label, add to album,
  download, and delete (tile disappears, photo lands in Trash); refine the query
  and confirm selection resets; clear the query and confirm the toolbar and
  select mode disappear.
