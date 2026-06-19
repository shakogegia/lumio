# Grid View Modes + Photo-Grid Refactor — Design

**Date:** 2026-06-19
**Status:** Approved (pending spec review)

## Goal

Two related changes to the photo grid:

1. **Refactor** the crucial `photo-grid.tsx` (one ~300-line file at
   `app/(app)/photos/photo-grid.tsx`) into a focused multi-file module under
   `components/photo-grid/`, using `cva` for the cell variants. Behavior-preserving.
2. **Add a third grid view mode**, `card` (Lightroom-style): each cell becomes a grey
   card surface with the photo *contained* and inset by a uniform margin, leaving room
   for future per-photo chrome (color labels, ratings, title). This generalizes today's
   two-state cover/contain control into a single 3-way **view mode** picked from a
   dropdown menu.

The current state already has (committed): a `cover`/`contain` toggle persisted to
localStorage, rendered as a smooth GPU zoom (`8d5700b`).

## The model decision

`cover`/`contain` are about how the image fills its frame. The Lightroom view is a
different *cell presentation* — a card surface + padding + future metadata — and only
makes sense with a contained image. So `card` is a **peer** of fill/fit, not a
combination. We model all three as one enum rather than two interacting toggles:

| mode   | image            | cell |
|--------|------------------|------|
| `fill` | cover (zoom)     | edge-to-edge, no chrome (today's default) |
| `fit`  | contain (zoom)   | letterbox on page bg, no chrome (today's contain) |
| `card` | contain          | grey card surface + uniform padding + room for label/rating/title |

## Non-goals (YAGNI)

- **No metadata yet.** `card` mode is image-on-card only. Color-label borders, rating
  stars, and titles are explicitly future work — the cell structure just leaves an
  obvious slot for them.
- **No pixel-perfect cross-mode morph.** `fill ↔ fit` keep the smooth zoom; switching
  into/out of `card` is a lighter transition (see Transitions). We won't animate padding
  across a virtualized grid.
- **No change** to pagination behavior, virtualization tuning, selection logic, the
  thumbnails API, or the album/library view wiring beyond swapping the control component.
- **No new non-square cell shapes.** Cells stay square in all modes.

## View-mode model

- **New type** `GridViewMode = "fill" | "fit" | "card"`, default `"fill"`.
- **Rename** `lib/use-thumbnail-fit.ts` → `lib/use-grid-view.ts`. `useThumbnailFit` →
  `useGridView`, returning `{ mode, setMode }` (was `{ fit, toggle }`). Same
  `useSyncExternalStore` + localStorage + cross-tab `storage` machinery.
- **Storage:** new key `lumio:grid-view`. On read, if the new key is absent, fall back to
  the old `lumio:thumbnail-fit` and map `cover→fill` / `contain→fit` so the existing
  preference carries over. Default `fill`.

## The control (menu, matching the sidebar)

- **Rename** `components/thumbnail-fit-toggle.tsx` → `components/grid-view-menu.tsx`.
  `ThumbnailFitToggle` → `GridViewMenu`, props `{ mode, onModeChange }`.
- A shadcn `DropdownMenu` (same primitive set used by `sidebar-more.tsx`): an outline
  `icon-sm` `Button` trigger (`LayoutGrid` icon, `aria-label`/`title` "Grid view") opening
  a `DropdownMenuRadioGroup` bound to `mode`, with three `DropdownMenuRadioItem`s:
  - **Fill** — `Maximize`
  - **Fit** — `Minimize`
  - **Card** — `LayoutGrid` (or `Proportions`; swappable)

  Mirrors the Theme submenu pattern in `sidebar-more.tsx` exactly (radio group, active
  item shows the standard indicator). Selecting an item calls `onModeChange(value)`.
- `library-view.tsx` and `album-view.tsx` each call `useGridView()`, render
  `<GridViewMenu mode onModeChange={setMode} />` where the toggle was, and pass
  `mode` to `<PhotoGrid>`.

## Architecture — the refactor

Move `app/(app)/photos/photo-grid.tsx` → `components/photo-grid/`:

| file | responsibility |
|------|----------------|
| `photo-grid.tsx` | Orchestrator: owns virtualization (`useWindowVirtualizer`), layout math (columns/tileSize/rows), the near-end → `loadMore` effect, and renders rows + skeleton/empty/error. Exports `PhotoGrid`. |
| `use-photo-pages.ts` | Data hook: encapsulates `photos`, `cursor`, `done`, `error`, and `loadMore` (the `fetchPage` + pagination state). Returns `{ photos, done, error, loadMore }`. |
| `photo-grid-tile.tsx` | One cell: chooses `Link` vs selectable `<button>` wrapper, the selection checkbox overlay + selected scale, applies the cell `cva` variants, renders `<PhotoThumb>` and the (future) metadata slot. |
| `photo-thumb.tsx` | The image renderer (today's `GridThumb`) + zoom logic, driven by `mode` (cover for `fill`, contain for `fit`/`card`). |
| `photo-grid-skeleton.tsx` | The warm-grey CSS skeleton grid. |
| `cell-variants.ts` | `cva` for the cell container: `mode` variant (`card` adds surface + padding) × `selected` boolean. |

**Boundaries / interfaces:**
- `PhotoGrid` keeps its current public props (`endpoint`, `albumId`, `empty`,
  `selectMode`, `selectedIds`, `onSelectionChange`) and **adds** `mode: GridViewMode`
  (replacing `fit`).
- `use-photo-pages.ts` and `lib/use-grid-view.ts` stay hooks (consistent with
  `use-grid-selection`, etc.). `use-photo-pages.ts` lives inside the folder (grid-only);
  `use-grid-view.ts` stays in `lib/` (also used by the header control).
- `PHOTOS_EMPTY` default empty state stays colocated in `photo-grid.tsx`.
- `cva` is introduced only where classNames branch on the enum (the cell), matching
  `button.tsx`'s use of `cva`.
- Selection/shift-range logic (`computeSelection`, `anchorRef`) stays in `photo-grid.tsx`
  (it's orchestration-level: depends on the full `photos` list and is passed down to
  tiles as `onTileClick(index, event)`).

The refactor must preserve: initial load + scroll-driven infinite load, the skeleton
that paints pre-hydration, window virtualization with `scrollMargin`, square tiles,
select-mode (shift-click ranges, checkbox overlay, 0.92 selected scale), the zoom morph,
and the retry-on-error affordance.

> Note: the two pre-existing `react-hooks/set-state-in-effect` lint errors on the
> `loadMore` effects are inherent to scroll-driven infinite load and move with the code;
> they are not in scope to "fix" here.

## Card rendering

In `card` mode the cell (`cva`) gets a `bg-muted` surface, uniform padding (~`p-2`),
and `rounded`. `<PhotoThumb>` renders **contained** within that padded inner box
(reusing the contain branch of the zoom logic — the contain math is relative to the
thumb's container, so a smaller padded frame just yields a smaller contained image). The
tile leaves a clearly-commented slot for future metadata. `fill`/`fit` cells render with
no surface/padding, exactly as today.

## Transitions

- `fill ↔ fit`: the existing GPU zoom (transform scale on the image) is unchanged.
- Into/out of `card`: the surface fades via `transition-colors`; the image resizes to the
  padded frame. No padding animation. Acceptable to snap; we tune on-screen.

## Data flow

```
library-view / album-view (useGridView → { mode, setMode })
  HeaderBar actions: <GridViewMenu mode onModeChange={setMode} />   (DropdownMenu radio)
  <PhotoGrid mode … />
    use-photo-pages → { photos, done, error, loadMore }
    useWindowVirtualizer (rows) + layout math
    rows.map → <PhotoGridTile mode selected onTileClick …>
                  cell-variants(mode, selected)
                  <PhotoThumb photo mode />   (cover|contain zoom)
                  (selection overlay; future metadata slot)
```

## Edge cases

- **Storage migration:** absent new key → read old key, map cover/contain; unknown/absent →
  `fill`. Same SSR-safe `useSyncExternalStore` (server snapshot = `fill`), no hydration flash.
- **Invalid dimensions:** `PhotoThumb` already guards `w>0 && h>0` (falls back to scale 1).
- **Card + select mode:** the selection ring/checkbox and the 0.92 selected scale apply to
  the card cell the same way they apply to bare cells.

## Testing

- **Browser-verify:** the view menu replaces the toggle in both Library and Album headers;
  opening it shows Fill/Fit/Card with the active one checked. Fill = edge-to-edge cover;
  Fit = letterbox on page bg; Card = photo inset on a grey card. Choice persists across
  reload and routes, syncs across tabs. fill↔fit still zooms. Select mode, infinite scroll,
  skeleton, and the photo-detail link still work after the move.
- **Unit:** no new pure logic beyond the storage mapping; if convenient, a small test for
  the cover/contain → fill/fit migration mapping. Existing grid-layout/selection tests must
  still pass unchanged.

## Commit sequence

1. ✅ `8d5700b` — zoom morph + rounded corners (baseline, already committed).
2. **Refactor** into `components/photo-grid/` — split + `cva`, behavior-preserving, still
   the cover/contain toggle. Reviewable on its own.
3. **Feature** — `GridViewMode` enum, `useGridView`, `GridViewMenu` dropdown, and `card`
   rendering.
