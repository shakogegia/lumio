# Albums page: Select, grid-size, and smart/regular split

**Date:** 2026-06-19
**Status:** Approved (design)

## Summary

Bring the `/albums` listing page up to parity with the `/photos` library and
album-detail views by adding the same header controls and a clearer layout:

1. **Select mode** — pick multiple albums and **bulk-delete** them.
2. **Grid size** — a density slider for the album cards, with its **own**
   persisted column count independent from the photo grid.
3. **Smart/regular split** — show regular **Albums** and **Smart Albums** as two
   separate labeled sections on the same page.

## Motivation

`/photos` and `/albums/[id]` already share a trio of header controls
(`GridViewMenu`, `GridSizeMenu`, a **Select** button). The `/albums` listing has
none of them — it's a static server-rendered grid of `<Link>` cards. This adds
the two controls that make sense for a grid of albums (density + select; album
cards have no justified/square "view mode"), and groups smart albums apart from
hand-made ones so the page reads clearly.

## Current state

- `apps/web/src/app/(app)/albums/page.tsx` — server component. Calls
  `listAlbumSummaries()` and renders a responsive CSS grid of album `<Link>`
  cards, or a single `Empty` state when there are no albums. The header is a
  `HeaderBar title="Albums"` with a `NewAlbumDialog` action.
- `AlbumSummaryDTO` already carries `isSmart`, `coverPhotoId`, `photoCount`.
- `useGridSelection()` is ID-agnostic (operates on a `Set<string>`) — reusable
  for album IDs as-is.
- `useGridColumns()` is a **single global** persisted density (key
  `lumio:grid-columns`) shared by the photo library and album-detail grids; it
  also drives a `--grid-columns` CSS variable read by a pre-paint script in the
  root layout.
- `GridSizeMenu` is generic over a `{ columns, onColumnsChange }` pair.
- `PhotoGridTile` is the reference pattern for a selectable tile: in select mode
  it's a `<button aria-pressed>` with a `CheckCircle2/Circle` overlay, a selected
  ring (`cellVariants({ selected })`), and a shrink-on-select transform.
- `SelectionToolbar` + `HeaderBar` + `useConfirm` are reusable.
- Album deletion: `deleteAlbum(id)` service + `DELETE /api/albums/[id]` route
  (single album only). `prisma.album.delete` cascades to `albumPhoto`.

## Design

### Architecture

Split `albums/page.tsx` the same way `/photos` is split:

- **Server page** (`page.tsx`) stays thin: fetch `listAlbumSummaries()` and pass
  the array into a new client component `AlbumsView`. (Mirrors
  `photos/page.tsx → LibraryView`.)
- After a bulk delete (or an album create), call `router.refresh()` to re-run
  the server fetch and re-render `AlbumsView` with fresh data — the same refresh
  pattern `album-view.tsx` already uses.

### Components

1. **`AlbumsView`** (new, client) — owns selection + density state; renders the
   header (normal vs. select toolbar) and the two album sections.
2. **`AlbumCard`** (new, client) — extracted from the inline `<Link>` currently
   in `page.tsx`. Renders:
   - **Normal mode:** a `<Link href={/albums/${id}}>` (today's card markup:
     cover image or `Images` placeholder + truncated name + photo count).
   - **Select mode:** a toggle `<button aria-pressed={isSelected}>` that toggles
     membership in the selection set instead of navigating, with a
     `CheckCircle2/Circle` overlay, selected ring, and shrink-on-select —
     mirroring `PhotoGridTile`.
3. **`useAlbumColumns()`** (new hook) — a separate persisted density at key
   `lumio:album-columns`. To avoid duplicating the parse/clamp/
   `useSyncExternalStore` logic, extract a small factory from
   `use-grid-columns.ts` and build both hooks from it:
   - the photos hook keeps its `--grid-columns` CSS-var side-effect;
   - the album hook omits the CSS-var side-effect.
   Reuses the existing `COLUMNS_MIN = 2`, `COLUMNS_MAX = 12`, default `5`.

### Layout

- A small pure helper `partitionAlbums(albums)` splits the list into
  `{ regular, smart }` (preserving the incoming order within each group).
- Render a labeled **"Albums"** section first, then a **"Smart Albums"**
  section. Each section is a CSS grid with
  `style={{ gridTemplateColumns: 'repeat(${columns}, minmax(0, 1fr))' }}`.
- A section renders only when its group is non-empty. When **both** groups are
  empty, keep today's single `Empty` state ("No albums yet").
- `GridSizeMenu` is reused unchanged, wired to `useAlbumColumns()`.

### Header

- **Normal mode:** `HeaderBar title="Albums"`, actions =
  `GridSizeMenu` + **Select** button (`sel.enter`) + `NewAlbumDialog`.
- **Select mode:** `SelectionToolbar title="Select albums"` with the selected
  count, a destructive **Delete** action, and **Cancel** — replaces the whole
  header (the normal-mode controls are hidden), exactly like `LibraryView`.

### Selection + delete

- A single `useGridSelection()` shared across both sections. Album cards in
  either section toggle into the same `Set<string>`; the toolbar count reflects
  the combined total. A selection may freely mix smart and regular albums.
- Delete flow:
  1. `useConfirm()` → `"Delete N albums?"`, destructive. Description clarifies
     that the photos themselves are **not** deleted (e.g. "The photos stay in
     your library.").
  2. On confirm, send `DELETE /api/albums` with body `{ ids }`.
  3. On success: `sel.cancel()` + `router.refresh()`.
  4. On failure: `toast.error("Failed to delete albums.")`.

### API + service

- **Service:** add `deleteAlbums(ids: string[], db = prisma): Promise<number>`
  to `albums-service.ts`:
  ```ts
  const { count } = await db.album.deleteMany({ where: { id: { in: ids } } });
  return count;
  ```
  Tolerant of unknown ids (unlike single `deleteAlbum`, which throws). Cascades
  to `albumPhoto` exactly like the existing single delete. Works for smart and
  regular albums alike.
- **Route:** add a `DELETE` handler to the existing
  `apps/web/src/app/api/albums/route.ts`, wrapped in `withAuth`, with a
  zod-validated body `{ ids: string[] }` (non-empty array of non-empty strings).
  Returns `{ count }`. Add the schema to `@lumio/shared` alongside the existing
  album schemas (e.g. `deleteAlbumsSchema`).

### Testing

- **Factory / `useAlbumColumns`:** unit-test the shared parse/clamp helper for
  default + clamp behavior (mirror `use-grid-columns.test.ts`). Confirm
  `parseGridColumns` (and the existing test) still pass after the refactor.
- **`deleteAlbums`:** service test — deletes a mix of regular + smart albums,
  ignores unknown ids, returns the deleted count, and removes `albumPhoto` rows.
- **`partitionAlbums`:** pure-function unit test — correct split and
  within-group order preservation; empty groups.
- **Manual browser verification** per the project dev workflow: select across
  both sections, bulk delete, density slider persists independently from the
  photo grid, empty/partial-empty states.

## Deliberate trade-offs / non-goals

- **No pre-paint `--album-columns` variable.** Albums are server-rendered with
  data already present (no skeleton), so the root-layout pre-paint script is
  left untouched to avoid coupling. If a user has changed album density, a
  one-frame reflow may occur on load; acceptable, and revisitable later.
- **No album "view mode"** (justified/square). Album cards are fixed 4:3; only
  density applies. `GridViewMenu` is intentionally not added here.
- **No bulk operations beyond delete** (e.g. no bulk rename/merge). Out of scope.
- **No drag-to-select / range-select** for album cards beyond what
  `useGridSelection` provides via per-card toggles.
