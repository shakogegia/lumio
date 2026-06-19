# Grid size control + resize fix — design

Date: 2026-06-19

Two related improvements to the photo grid:

1. **Bug:** resizing the browser window does not re-flow the grid until the page
   is refreshed.
2. **Feature:** a header control (dedicated icon button → popover with a stepped
   slider) to adjust photo-grid tile size / density, persisted globally.

## Background

The grid lives in `apps/web/src/components/photo-grid/photo-grid.tsx`. Column
count is derived from the measured container width and a minimum tile width:

- `lib/grid-layout.ts` exposes `MIN_TILE = 280`, `GRID_GAP = 4`, and
  `computeColumns(width, minTile = MIN_TILE, gap = GRID_GAP)`.
- The grid measures its container width via a `ResizeObserver` and computes
  `columns` / `tileSize` from it.

The view-mode menu (`components/grid-view-menu.tsx` + `lib/use-grid-view.ts`) is
the pattern to mirror for a new persisted, globally-synced preference. It is
rendered in `library-view.tsx` and `albums/[id]/album-view.tsx`. `PhotoGrid` is
also used by `search/search-view.tsx`.

## 1. Resize bug fix (`photo-grid.tsx`)

### Root cause

Width is measured in a `useLayoutEffect` with an empty dependency array that
captures whichever element `listRef` points at on first mount. Photos load
asynchronously, so the first render returns the **skeleton** (`PhotoGridSkeleton`
holds `listRef`). The effect runs once, reads the skeleton's width, and attaches
a `ResizeObserver` to the skeleton node. When photos arrive the component
re-renders with the real grid `<div ref={listRef}>` and the skeleton unmounts —
but the effect never re-runs, so the observer keeps watching the now-detached
skeleton node. Width never updates again. A page refresh re-measures at mount,
which is why resizing only "works" after a refresh.

### Fix

Replace `useRef` + `useLayoutEffect([])` with a **callback ref**:

- On attach (node non-null): read `clientWidth` → `setWidth`, read `offsetTop` →
  `setOffsetTop`, create a `ResizeObserver` whose callback updates both width and
  offsetTop, and observe the node. Store the observer in a ref.
- On detach (node null): disconnect the observer.

Because React invokes the callback ref again when the underlying node changes
(skeleton → grid swap), the observer always tracks the live element. Window
resizes then update `width` → `columns` / `tileSize` immediately, no refresh.

## 2. Persisted size store (`lib/use-grid-size.ts`, new)

Mirrors `use-grid-view.ts`:

- `useSyncExternalStore` with a same-document listener `Set` plus the cross-tab
  `storage` event.
- localStorage key `lumio:grid-size`.
- Server snapshot / first-paint default = `280`.
- Pure `parseGridSize(stored: string | null): number` — parses the integer,
  clamps to `[TILE_MIN, TILE_MAX]`, snaps to the nearest `TILE_STEP`, and
  defaults to `280` for missing/invalid input. Unit-testable like
  `parseGridView`.
- Returns `{ size, setSize }`; `setSize` writes localStorage and notifies the
  local listener set so grids in the same tab update.

## 3. Range constants (`lib/grid-layout.ts`)

Keep `MIN_TILE = 280` as the default tile width. Add:

- `TILE_MIN = 160`
- `TILE_MAX = 400`
- `TILE_STEP = 40`

`computeColumns` already accepts a `minTile` argument; its logic is unchanged.

## 4. shadcn primitives (`ui/`)

Add the official `slider` and `popover` components via the shadcn CLI. These are
left unmodified per the project rule against editing `ui/*`. A Popover (not a
DropdownMenu) hosts the slider, because Radix DropdownMenu's roving arrow-key
focus conflicts with the slider's own arrow-key handling.

## 5. `GridSizeMenu` (`components/grid-size-menu.tsx`, new)

- Trigger: `Button variant="outline" size="icon-sm"` with a density/grid icon
  (e.g. `Grid2x2`), `aria-label`/`title` "Grid size".
- Content: a `Popover` containing a single stepped `Slider`
  (`min={TILE_MIN} max={TILE_MAX} step={TILE_STEP}`) with small "Smaller" /
  "Larger" end labels.
- Props: `{ size: number; onSizeChange: (size: number) => void }`, matching the
  `GridViewMenu` shape.

## 6. Wiring

- `PhotoGrid` gains `minTile?: number` (default `MIN_TILE`), threaded like the
  existing `mode` prop, and passes it to `computeColumns(width, minTile)`.
- `library-view.tsx` and `album-view.tsx`: add `useGridSize`, render
  `<GridSizeMenu size={size} onSizeChange={setSize} />` immediately after
  `<GridViewMenu>`, and pass `minTile={size}` to `<PhotoGrid>`.
- `search-view.tsx`: pass `minTile={size}` so density stays uniform; add
  `<GridSizeMenu>` to its header if it has an actions slot (confirmed during
  implementation).
- `PhotoGridSkeleton` continues to use the default `MIN_TILE`. The server has no
  client-side value yet, so the first paint uses the default and snaps to the
  stored size after hydration — the same "server assumes default" behavior the
  mode toggle already relies on.

## Scope note

The slider controls the **minimum / target** tile width, which determines column
count. Actual tile width still stretches to fill the row via `minmax(0, 1fr)`,
exactly as today. Larger value → wider target → fewer, larger tiles.

## Testing

- **Unit:** new `lib/use-grid-size.test.ts` covering `parseGridSize` —
  clamp below `TILE_MIN`, clamp above `TILE_MAX`, snap to nearest `TILE_STEP`,
  default on null/invalid.
- **Manual (browser):**
  - Drag the slider → tiles resize live across Library, Albums, and Search.
  - Reload → the chosen size persists.
  - Resize the window → the grid re-flows columns without a refresh.

## Out of scope

- Per-view (non-global) size preferences.
- Changing the gap between tiles.
- Touch/pinch-to-zoom gestures.
