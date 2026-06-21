# Lightbox sidebar "Appears in" album membership

**Date:** 2026-06-21
**Status:** Approved design, ready for plan

## Problem

The lightbox info tab shows album membership as a flat checkbox list
(`AlbumMembership` in `apps/web/src/components/photo-grid/lightbox-sidebar.tsx`).
A checkbox per regular album, checking/unchecking adds/removes the photo. It's
visually disconnected from the rest of the app's album UI, has no folder
structure, no cover thumbnails, no "create album" affordance, and no loading
state.

## Goal

Replace the checkbox list with an **"Appears in"** section that matches the
existing add-to-album UI:

- A list of the photo's current albums, each row styled like the picker's
  `AlbumOption` (cover thumbnail + name), with a hover-revealed remove (✕).
- An **"Add more"** button that opens the exact same dropdown the toolbar /
  right-click menu use (`AlbumPickerItems`: nested folder/album tree +
  "New album…").
- A `Skeleton` placeholder while membership / album data loads.

## Approach

Rebuild `AlbumMembership` to reuse the existing add-to-album machinery instead
of its own checkbox list and `/api/albums` fetch:

- **Album metadata** (name, `coverPhotoId`, `isSmart`, folder structure) comes
  from the shared `useLibraryTree()` — the same source the picker uses. The
  lightbox already renders inside `LibraryTreeProvider` (it wraps the whole
  `(app)` layout), so no new provider or fetch is needed. This deletes the
  parent component's separate `/api/albums` fetch.
- **Membership** still comes from `GET /api/photos/:id` (the grid photo carries
  no `albumIds`), keyed on `photo.id` so it re-initializes per photo during
  arrow-key navigation — same as today.
- **Adds / creates** go through `useAddToAlbum()`.
- **Removes** keep the existing `DELETE` + optimistic store patch.

## UI

```
Appears in
┌─────────────────────────────┐
│ ▣  Summer 2024          ✕   │   cover thumb + name; ✕ on row hover
│ ▣  Family               ✕   │
└─────────────────────────────┘
[ + Add more ]                    opens the AlbumPickerItems dropdown
```

- **Rows** reuse the `AlbumOption` visual: a `size-6` rounded cover thumbnail
  (`/api/thumbnails/:coverPhotoId`) or an `Images` fallback icon, plus a
  truncated name. A remove (✕) button is revealed on row hover and removes the
  photo from that album. Rows are only the photo's **regular** (non-smart)
  albums — intersect membership with the tree's non-smart albums.
- **"Add more"** is a text button (e.g. `Plus` + "Add more") that opens a
  `DropdownMenu` whose content is `AlbumPickerItems` — the same nested
  folder/album tree + "New album…" item used elsewhere. It receives
  `excludeAlbumIds = Set(current membership)` so already-joined albums don't
  appear in the menu.
- **Empty state** (photo in no regular albums): the "Appears in" heading, a
  muted "Not in any album yet" line, and the Add more button.
- **Loading state** (membership not yet fetched, or tree still loading): 2–3
  `Skeleton` rows (a `size-6` square + a text-width line) in place of the list.
- **Always shown:** the section renders even when the library has no albums yet
  (Add more / "New album…" can create the first one). This is a behavior change
  from today, where the section is hidden unless regular albums exist.

## Data flow

- **Add existing album:** `addToAlbumDirect([photo.id], albumId, { onSuccess })`.
  On success, optimistically add `albumId` to local membership and
  `patchPhotos(new Set([photo.id]), { albumIds: nextIds })` so the grid badge
  updates. `addToAlbumDirect` already handles the POST, the ActionComplete
  sound, `router.refresh()`, and the error toast.
- **New album:** `addToAlbum([photo.id])` opens the shared `AddToAlbumDialog`
  (rendered via the hook's `element`). On its `onAdded`, refetch
  `GET /api/photos/:id` to resync membership (the dialog doesn't return the new
  album id) and `patchPhotos` accordingly.
- **Remove:** `DELETE /api/albums/:id/photos/:photoId` → optimistic local
  removal + `patchPhotos`. Only commit on a successful (`res.ok`) response;
  toast on failure. Unchanged from the current `toggle()` removal path.

## Components touched / added

- **`lightbox-sidebar.tsx`**
  - Drop the parent's `/api/albums` fetch and the `regularAlbums.length > 0`
    gate. Always render the membership section.
  - Rewrite `AlbumMembership`: reads `useLibraryTree()` + `useAddToAlbum()`,
    keeps the `/api/photos/:id` membership fetch and `key={photo.id}` reset,
    renders the "Appears in" heading, rows, Add more dropdown, skeleton, and
    empty state.
- **`album-picker-items.tsx`** — add optional `excludeAlbumIds?: Set<string>`,
  threaded to `buildAlbumTree`. Existing single-`excludeAlbumId` callers
  unchanged.
- **`lib/library-tree-rows.ts`** — `buildAlbumTree` accepts
  `excludeAlbumIds?: Set<string>`; a pickable album must satisfy both
  `a.id !== excludeAlbumId` and `!excludeAlbumIds?.has(a.id)`.
- **`AlbumThumb`** — extract the `size-6` cover/`Images`-fallback markup
  (currently inline in `AlbumOption`) into a small shared component so both
  `AlbumOption` and the new membership rows use it. Co-locate in
  `album-picker-items.tsx` (or a small shared file) and have `AlbumOption`
  consume it.

## Out of scope

- Smart-album membership (can't be edited manually).
- Reordering albums.
- Bulk membership editing (this is single-photo, lightbox-only).

## Testing / verification

- Browser-verify in the lightbox info tab: list shows current albums with
  covers; hover ✕ removes; Add more opens the nested picker with already-joined
  albums hidden; picking adds and the row appears; "New album…" creates and the
  new album shows up; skeleton flashes while loading; empty state when the photo
  is in no albums; arrow-key navigation between photos resets membership
  correctly; the grid's album badge updates after add/remove.
