# Grid Size Control + Resize Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a header control with a stepped slider to adjust photo-grid tile size (persisted globally), and fix the bug where resizing the window doesn't re-flow the grid until a page refresh.

**Architecture:** The grid derives column count from a measured container width and a minimum tile width (`computeColumns(width, minTile)`). We make that `minTile` user-adjustable via a new globally-persisted store (`useGridSize`, mirroring `useGridView`), surfaced through a new `GridSizeMenu` (icon button → Popover → Slider). Separately, we replace the grid's one-shot measurement effect with a callback ref so the `ResizeObserver` re-attaches across the skeleton→grid element swap, restoring live resize.

**Tech Stack:** Next.js 16 (App Router, RSC), React 19, TypeScript, Tailwind, `radix-ui` (unified package), shadcn-style components, `@tanstack/react-virtual`, Vitest. Package manager: pnpm. All app code is under `apps/web/`.

---

## File Structure

**Create:**
- `apps/web/src/components/ui/slider.tsx` — shadcn-style Slider primitive wrapper (house style).
- `apps/web/src/components/ui/popover.tsx` — shadcn-style Popover primitive wrapper (house style).
- `apps/web/src/lib/use-grid-size.ts` — persisted, globally-synced tile-size store + pure `parseGridSize`.
- `apps/web/src/lib/use-grid-size.test.ts` — unit tests for `parseGridSize`.
- `apps/web/src/components/grid-size-menu.tsx` — icon button + Popover + Slider control.

**Modify:**
- `apps/web/src/lib/grid-layout.ts` — add tile-size bound constants.
- `apps/web/src/lib/grid-layout.test.ts` — add a `computeColumns` custom-`minTile` case.
- `apps/web/src/components/photo-grid/photo-grid.tsx` — callback-ref measurement (resize fix) + `minTile` prop.
- `apps/web/src/app/(app)/photos/library-view.tsx` — wire `useGridSize` + `GridSizeMenu` + `minTile`.
- `apps/web/src/app/(app)/albums/[id]/album-view.tsx` — wire `useGridSize` + `GridSizeMenu` + `minTile`.
- `apps/web/src/app/(app)/search/search-view.tsx` — pass `minTile={size}` so density stays uniform.

**Conventions:** Commits use Conventional Commits with `(web)` scope. Git/commit commands run from the repo root; build/test/lint commands run from `apps/web` (shown inline as `cd apps/web && ...`). Single-file tests: `cd apps/web && pnpm exec vitest run <path>`.

---

## Task 1: Tile-size bound constants

**Files:**
- Modify: `apps/web/src/lib/grid-layout.ts`
- Test: `apps/web/src/lib/grid-layout.test.ts`

`MIN_TILE` (280) stays as the default target tile width used by `computeColumns` and the skeleton. We add the slider's bounds as separate, clearly-named constants so they don't collide with `MIN_TILE`. Note 280 lands exactly on the step grid (160 + 3×40), so the default is a valid slider stop.

- [ ] **Step 1: Write the failing test**

Add this case to the existing `describe` block in `apps/web/src/lib/grid-layout.test.ts` (import `computeColumns` is already present):

```typescript
it("uses a custom minTile to widen tiles (fewer columns)", () => {
  // 1200px wide, gap 4. Default minTile 280 -> 4 cols; minTile 400 -> 3 cols.
  expect(computeColumns(1200, 280, 4)).toBe(4);
  expect(computeColumns(1200, 400, 4)).toBe(3);
  expect(computeColumns(1200, 160, 4)).toBe(7);
});
```

- [ ] **Step 2: Run test to verify current behavior**

Run: `cd apps/web && pnpm exec vitest run src/lib/grid-layout.test.ts`
Expected: PASS (this asserts existing `computeColumns` behavior — it documents the custom-`minTile` contract the slider relies on). If it FAILS, stop and reconcile the math before continuing.

- [ ] **Step 3: Add the constants**

In `apps/web/src/lib/grid-layout.ts`, replace the top two lines:

```typescript
export const MIN_TILE = 280;
export const GRID_GAP = 4;
```

with:

```typescript
// Default target tile width. Used by computeColumns and the skeleton when no
// user size is set. Also the default value of the grid-size store.
export const MIN_TILE = 280;
export const GRID_GAP = 4;

// Bounds for the user-adjustable tile size (the grid-size slider). Distinct from
// MIN_TILE (the *default*): TILE_SIZE_MIN/MAX are the slider's endpoints.
export const TILE_SIZE_MIN = 160;
export const TILE_SIZE_MAX = 400;
export const TILE_SIZE_STEP = 40;
```

- [ ] **Step 4: Run tests + typecheck**

Run: `cd apps/web && pnpm exec vitest run src/lib/grid-layout.test.ts && pnpm exec tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/grid-layout.ts apps/web/src/lib/grid-layout.test.ts
git commit -m "feat(web): add tile-size bound constants for grid sizing"
```

---

## Task 2: Slider + Popover UI primitives

**Files:**
- Create: `apps/web/src/components/ui/slider.tsx`
- Create: `apps/web/src/components/ui/popover.tsx`

These are shadcn-style wrappers over the unified `radix-ui` package (matching `ui/dropdown-menu.tsx`). The Popover surface matches the house style used by `DropdownMenuContent` (`rounded-2xl bg-popover shadow-2xl ring-1 ring-foreground/5`) rather than the stock shadcn `rounded-md border shadow-md`, so it looks native. Do not hand-edit these later — they follow the project's "don't modify `ui/*`" rule.

- [ ] **Step 1: Create the Slider component**

Create `apps/web/src/components/ui/slider.tsx`:

```tsx
"use client"

import * as React from "react"
import { Slider as SliderPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  const _values = React.useMemo(
    () =>
      Array.isArray(value)
        ? value
        : Array.isArray(defaultValue)
          ? defaultValue
          : [min, max],
    [value, defaultValue, min, max]
  )

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        "relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className={cn(
          "bg-muted relative grow overflow-hidden rounded-full data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5"
        )}
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className={cn(
            "bg-primary absolute data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
          )}
        />
      </SliderPrimitive.Track>
      {Array.from({ length: _values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          className="border-primary bg-background ring-ring/50 block size-4 shrink-0 rounded-full border shadow-sm transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50"
        />
      ))}
    </SliderPrimitive.Root>
  )
}

export { Slider }
```

- [ ] **Step 2: Create the Popover component**

Create `apps/web/src/components/ui/popover.tsx`:

```tsx
"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-2xl bg-popover p-4 text-popover-foreground shadow-2xl ring-1 ring-foreground/5 outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 dark:ring-foreground/10 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && pnpm exec tsc --noEmit`
Expected: no type errors. (Confirms `radix-ui` exports `Slider`/`Popover` and the JSX types resolve.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ui/slider.tsx apps/web/src/components/ui/popover.tsx
git commit -m "feat(web): add Slider and Popover ui primitives"
```

---

## Task 3: Persisted grid-size store

**Files:**
- Create: `apps/web/src/lib/use-grid-size.ts`
- Test: `apps/web/src/lib/use-grid-size.test.ts`

Mirrors `use-grid-view.ts`: `useSyncExternalStore` with a same-document listener set plus the cross-tab `storage` event, localStorage key `lumio:grid-size`, server/first-paint default `MIN_TILE`. `parseGridSize` is pure and clamps/snaps. **Important:** `Number(null)` and `Number("")` are `0`, not `NaN`, so null/empty must be handled before the numeric path or the default would wrongly become 160.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/use-grid-size.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { parseGridSize } from "./use-grid-size";

describe("parseGridSize", () => {
  it("defaults to 280 when nothing is stored", () => {
    expect(parseGridSize(null)).toBe(280);
    expect(parseGridSize("")).toBe(280);
  });

  it("defaults to 280 for non-numeric input", () => {
    expect(parseGridSize("garbage")).toBe(280);
    expect(parseGridSize("NaN")).toBe(280);
  });

  it("returns valid on-step values as-is", () => {
    expect(parseGridSize("160")).toBe(160);
    expect(parseGridSize("280")).toBe(280);
    expect(parseGridSize("400")).toBe(400);
  });

  it("clamps below the minimum and above the maximum", () => {
    expect(parseGridSize("80")).toBe(160);
    expect(parseGridSize("999")).toBe(400);
  });

  it("snaps off-step values to the nearest step", () => {
    expect(parseGridSize("181")).toBe(200); // 181 -> nearest of 160/200 is 200
    expect(parseGridSize("175")).toBe(160); // 175 -> nearest of 160/200 is 160
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm exec vitest run src/lib/use-grid-size.test.ts`
Expected: FAIL — cannot find module `./use-grid-size` / `parseGridSize` is not defined.

- [ ] **Step 3: Implement the store**

Create `apps/web/src/lib/use-grid-size.ts`:

```typescript
"use client";

import { useCallback, useSyncExternalStore } from "react";
import { MIN_TILE, TILE_SIZE_MAX, TILE_SIZE_MIN, TILE_SIZE_STEP } from "@/lib/grid-layout";

const STORAGE_KEY = "lumio:grid-size";

/**
 * Resolve the stored grid tile size: an integer clamped to
 * [TILE_SIZE_MIN, TILE_SIZE_MAX] and snapped to the nearest TILE_SIZE_STEP,
 * defaulting to MIN_TILE for missing/invalid input. Pure for testability.
 */
export function parseGridSize(stored: string | null): number {
  if (stored === null || stored.trim() === "") return MIN_TILE;
  const n = Number(stored);
  if (!Number.isFinite(n)) return MIN_TILE;
  const clamped = Math.min(TILE_SIZE_MAX, Math.max(TILE_SIZE_MIN, n));
  const snapped =
    Math.round((clamped - TILE_SIZE_MIN) / TILE_SIZE_STEP) * TILE_SIZE_STEP + TILE_SIZE_MIN;
  return snapped;
}

// Same-document subscribers. The native `storage` event only fires in *other*
// tabs, so we keep our own listener set and notify it after a local write to
// keep grids in the current tab in sync.
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getSnapshot(): number {
  return parseGridSize(localStorage.getItem(STORAGE_KEY));
}

// The server (and the first hydration pass) always assume the default; the real
// value is read on the client after mount. useSyncExternalStore swaps to the
// client snapshot without a hydration mismatch.
function getServerSnapshot(): number {
  return MIN_TILE;
}

/**
 * Global, persisted grid tile size (the minimum/target tile width that sets the
 * column count). Persisted to localStorage so the choice carries across routes
 * and reloads, and synced across tabs via the `storage` event.
 */
export function useGridSize() {
  const size = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setSize = useCallback((next: number) => {
    localStorage.setItem(STORAGE_KEY, String(next));
    listeners.forEach((cb) => cb());
  }, []);

  return { size, setSize };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm exec vitest run src/lib/use-grid-size.test.ts`
Expected: PASS (all 5 cases).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/use-grid-size.ts apps/web/src/lib/use-grid-size.test.ts
git commit -m "feat(web): add persisted grid-size store (useGridSize)"
```

---

## Task 4: GridSizeMenu control

**Files:**
- Create: `apps/web/src/components/grid-size-menu.tsx`

Icon button → Popover → stepped Slider, with "Smaller / Larger" end labels. Props mirror `GridViewMenu` (`{ value, onChange }`-style). The slider works on a single-element array; `onValueChange` returns the array, from which we read index 0.

- [ ] **Step 1: Create the component**

Create `apps/web/src/components/grid-size-menu.tsx`:

```tsx
"use client";

import { Grid2x2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { TILE_SIZE_MAX, TILE_SIZE_MIN, TILE_SIZE_STEP } from "@/lib/grid-layout";

/**
 * Header control to adjust grid tile size. An icon-button trigger opens a
 * Popover with a stepped slider (Popover, not DropdownMenu, so the slider's
 * arrow-key handling isn't captured by menu roving focus). Larger value →
 * wider target tile → fewer, larger tiles.
 */
export function GridSizeMenu({
  size,
  onSizeChange,
}: {
  size: number;
  onSizeChange: (size: number) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon-sm" aria-label="Grid size" title="Grid size">
          <Grid2x2 />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56">
        <Slider
          value={[size]}
          min={TILE_SIZE_MIN}
          max={TILE_SIZE_MAX}
          step={TILE_SIZE_STEP}
          onValueChange={(values) => {
            const next = values[0];
            if (typeof next === "number") onSizeChange(next);
          }}
          aria-label="Grid tile size"
        />
        <div className="mt-3 flex justify-between text-xs text-muted-foreground">
          <span>Smaller</span>
          <span>Larger</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `cd apps/web && pnpm exec tsc --noEmit && pnpm lint`
Expected: no type errors, no lint errors. If `Grid2x2` is not exported by the installed `lucide-react` (v1.x), substitute `Grid3x3` (also a grid icon) and re-run.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/grid-size-menu.tsx
git commit -m "feat(web): add GridSizeMenu (icon + popover + stepped slider)"
```

---

## Task 5: Photo-grid resize fix + minTile prop

**Files:**
- Modify: `apps/web/src/components/photo-grid/photo-grid.tsx`

Two changes in one file: (a) replace the one-shot `useLayoutEffect` measurement with a callback ref that re-attaches the `ResizeObserver` whenever the measured node changes (fixes resize after the skeleton→grid swap); (b) add a `minTile` prop threaded into `computeColumns`.

- [ ] **Step 1: Update the React imports**

In `apps/web/src/components/photo-grid/photo-grid.tsx`, replace line 3:

```tsx
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
```

with:

```tsx
import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
```

- [ ] **Step 2: Import MIN_TILE**

Replace line 6:

```tsx
import { computeColumns, rowCount, GRID_GAP } from "@/lib/grid-layout";
```

with:

```tsx
import { computeColumns, rowCount, GRID_GAP, MIN_TILE } from "@/lib/grid-layout";
```

- [ ] **Step 3: Add the `minTile` prop**

In the destructured props (currently starting at line 44), add `minTile` next to `mode`. Change:

```tsx
  empty = PHOTOS_EMPTY,
  mode = "fill",
  params,
```

to:

```tsx
  empty = PHOTOS_EMPTY,
  mode = "fill",
  minTile = MIN_TILE,
  params,
```

And in the props type block, add the `minTile` field next to `mode`. Change:

```tsx
  empty?: React.ReactNode;
  mode?: GridViewMode;
  params?: URLSearchParams;
```

to:

```tsx
  empty?: React.ReactNode;
  mode?: GridViewMode;
  /** Minimum/target tile width driving column count. Defaults to MIN_TILE. */
  minTile?: number;
  params?: URLSearchParams;
```

- [ ] **Step 4: Replace the measurement effect with a callback ref**

Replace this block (currently lines 96–111):

```tsx
  const listRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [offsetTop, setOffsetTop] = useState(0);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    setOffsetTop(el.offsetTop);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
```

with:

```tsx
  const [width, setWidth] = useState(0);
  const [offsetTop, setOffsetTop] = useState(0);
  const roRef = useRef<ResizeObserver | null>(null);

  // Callback ref so measurement re-attaches whenever the underlying node
  // changes. The grid swaps elements as photos load (skeleton → real grid); a
  // one-shot effect would keep observing the detached skeleton, so window
  // resizes were missed until a refresh. Re-running on each node change fixes it.
  const measureRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    if (!el) {
      roRef.current = null;
      return;
    }
    const measure = () => {
      setWidth(el.clientWidth);
      setOffsetTop(el.offsetTop);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    roRef.current = ro;
  }, []);
```

- [ ] **Step 5: Pass `minTile` into `computeColumns`**

Change (currently line 113):

```tsx
  const columns = computeColumns(width);
```

to:

```tsx
  const columns = computeColumns(width, minTile);
```

- [ ] **Step 6: Point both render branches at the callback ref**

Change the skeleton return (currently line 151):

```tsx
    return <PhotoGridSkeleton listRef={listRef} />;
```

to:

```tsx
    return <PhotoGridSkeleton listRef={measureRef} />;
```

And change the main container ref (currently line 155):

```tsx
    <div ref={listRef}>
```

to:

```tsx
    <div ref={measureRef}>
```

(`PhotoGridSkeleton` already types `listRef` as `React.Ref<HTMLDivElement>`, which accepts a callback ref — no change needed there.)

- [ ] **Step 7: Re-measure when minTile changes**

The existing `virtualizer.measure()` effect already depends on `[tileSize, columns]`; since `columns` depends on `minTile`, changing the slider re-measures automatically. No change needed — just confirm this effect (currently around line 131) still reads `[tileSize, columns]`.

- [ ] **Step 8: Typecheck + lint**

Run: `cd apps/web && pnpm exec tsc --noEmit && pnpm lint`
Expected: no type errors, no lint errors. In particular, `useLayoutEffect` and the old `listRef` must no longer be referenced anywhere in the file.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/photo-grid/photo-grid.tsx
git commit -m "fix(web): re-attach grid ResizeObserver via callback ref; add minTile prop"
```

---

## Task 6: Wire the control into the views

**Files:**
- Modify: `apps/web/src/app/(app)/photos/library-view.tsx`
- Modify: `apps/web/src/app/(app)/albums/[id]/album-view.tsx`
- Modify: `apps/web/src/app/(app)/search/search-view.tsx`

`library-view` and `album-view` already render `GridViewMenu`; add `GridSizeMenu` next to it and thread `minTile`. `search-view` has no header actions slot (its header is the search box), so it gets no menu — but it still passes `minTile={size}` so its grid honors the global size set elsewhere.

- [ ] **Step 1: Wire library-view**

In `apps/web/src/app/(app)/photos/library-view.tsx`:

Add imports after the existing `useGridView` import (line 7):

```tsx
import { useGridSize } from "@/lib/use-grid-size";
import { GridSizeMenu } from "@/components/grid-size-menu";
```

Add the hook next to `useGridView` (after line 18 `const { mode, setMode } = useGridView();`):

```tsx
  const { size, setSize } = useGridSize();
```

In the non-select `HeaderBar` actions, add the menu after `<GridViewMenu ... />` (around line 68):

```tsx
              <GridViewMenu mode={mode} onModeChange={setMode} />
              <GridSizeMenu size={size} onSizeChange={setSize} />
```

Pass `minTile` to the grid. Change the `<PhotoGrid>` opening (around line 77–79):

```tsx
      <PhotoGrid
        apiRef={gridRef}
        mode={mode}
```

to:

```tsx
      <PhotoGrid
        apiRef={gridRef}
        mode={mode}
        minTile={size}
```

- [ ] **Step 2: Wire album-view**

In `apps/web/src/app/(app)/albums/[id]/album-view.tsx`:

Add imports after the `useGridView` import (line 8):

```tsx
import { useGridSize } from "@/lib/use-grid-size";
import { GridSizeMenu } from "@/components/grid-size-menu";
```

Add the hook after line 34 (`const { mode, setMode } = useGridView();`):

```tsx
  const { size, setSize } = useGridSize();
```

In the `HeaderBar` actions, add the menu after `<GridViewMenu ... />` (around line 102):

```tsx
              <GridViewMenu mode={mode} onModeChange={setMode} />
              <GridSizeMenu size={size} onSizeChange={setSize} />
```

Pass `minTile` to the grid. Change the `<PhotoGrid>` block (around line 116–120) — add `minTile={size}` after `mode={mode}`:

```tsx
      <PhotoGrid
        key={reloadKey}
        endpoint={`/api/albums/${albumId}/photos`}
        albumId={albumId}
        mode={mode}
        minTile={size}
```

- [ ] **Step 3: Wire search-view**

In `apps/web/src/app/(app)/search/search-view.tsx`:

Add the import after the React import (line 3):

```tsx
import { useGridSize } from "@/lib/use-grid-size";
```

Add the hook inside `SearchView`, after the `inputRef` line (around line 25):

```tsx
  const { size } = useGridSize();
```

Pass `minTile` to the grid. Change the `<PhotoGrid>` block (around line 82–88) — add `minTile={size}` after the `key`:

```tsx
            <PhotoGrid
              key={serialize(filters)}
              minTile={size}
              endpoint="/api/search"
              params={paramsFor(filters)}
              hrefFor={(id) => `/photo/${id}?${scopeQuery(filters)}`}
              empty={<SearchEmpty />}
            />
```

- [ ] **Step 4: Typecheck + lint**

Run: `cd apps/web && pnpm exec tsc --noEmit && pnpm lint`
Expected: no type errors, no lint errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(app\)/photos/library-view.tsx apps/web/src/app/\(app\)/albums/\[id\]/album-view.tsx apps/web/src/app/\(app\)/search/search-view.tsx
git commit -m "feat(web): wire GridSizeMenu into library, album, and search views"
```

---

## Task 7: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite + lint**

Run: `cd apps/web && pnpm test && pnpm lint`
Expected: all tests pass, no lint errors.

- [ ] **Step 2: Start the dev server**

Run (background): `cd apps/web && pnpm dev`
Open `http://localhost:3000` (log in if prompted) and navigate to the Library.

- [ ] **Step 3: Manual — slider resizes tiles live**

- Click the new grid-size icon button (next to the grid-view button) in the Library header.
- Drag the slider. Expected: tiles grow/shrink and the column count changes live as you move it (7 columns near the small end on a wide window, down to ~3 near the large end), with no flicker or page reload.

- [ ] **Step 4: Manual — persistence + cross-view**

- Set a non-default size, then reload the page. Expected: the size is retained.
- Navigate to an Album and to Search. Expected: both grids render at the chosen density (Album shows the same icon control; Search has no control but matches the density).

- [ ] **Step 5: Manual — window resize re-flows (the bug fix)**

- On the Library, drag the browser window narrower and wider (or use the OS resize). Expected: the grid re-flows its column count continuously **without** a refresh. (Before this change it would only update after reload.)
- Reload while the window is narrow, confirm initial render is correct, then widen — still re-flows.

- [ ] **Step 6: Stop the dev server and report**

Stop the background dev server. Summarize verification results (what was observed for steps 3–5).
```
