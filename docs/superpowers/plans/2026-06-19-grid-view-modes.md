# Grid View Modes + Photo-Grid Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the crucial `photo-grid.tsx` into a focused `components/photo-grid/` module, then add a Lightroom-style `card` view mode by generalizing the cover/contain toggle into a 3-way (`fill`/`fit`/`card`) dropdown-menu control.

**Architecture:** Two commits. (A) Behavior-preserving refactor: split the single grid file into orchestrator + data hook + tile + thumb + skeleton; importers updated. (B) Feature: introduce a `GridViewMode` enum + `useGridView` hook (with localStorage migration), a `GridViewMenu` dropdown matching the sidebar's theme picker, a `cva` cell, and `card` rendering (contained image on a `bg-muted` padded surface).

**Tech Stack:** Next.js (App Router, `--webpack`), React client components, `@tanstack/react-virtual`, `class-variance-authority`, shadcn `dropdown-menu`, lucide-react, Vitest.

---

## Conventions for this plan

- All paths are relative to repo root. The web app is `apps/web`; run commands from `apps/web`.
- **Verify command (run after every code step unless noted):**
  `cd apps/web && npx tsc --noEmit`
  Expected: no output (exit 0).
- **Lint a file:** `cd apps/web && npx eslint "<path>"`.
  Two pre-existing `react-hooks/set-state-in-effect` errors live on the infinite-scroll
  effects (`loadMore`). They are inherent to scroll-driven loading and **move with the
  code** — they are expected and NOT in scope to fix. The bar is "no NEW lint errors."
- **Tests:** `cd apps/web && npm test` (Vitest, exit 0, all pass).
- Only `parseGridView` is unit-tested (pure logic). Everything else is presentational/
  wiring and is browser-verified, matching the spec and repo convention (only `lib/*`
  pure functions have tests).

---

# Phase A — Refactor (behavior-preserving)

**One commit at the end of Phase A.** Each task leaves the build compiling; do not commit
mid-phase. Phase A keeps the existing `fit: "cover" | "contain"` prop and the
`ThumbnailFitToggle` exactly as-is — no behavior change.

## Task A1: Move the grid file into a folder

**Files:**
- Move: `apps/web/src/app/(app)/photos/photo-grid.tsx` → `apps/web/src/components/photo-grid/photo-grid.tsx`
- Modify: `apps/web/src/app/(app)/photos/library-view.tsx`
- Modify: `apps/web/src/app/(app)/albums/[id]/album-view.tsx`

- [ ] **Step 1: git mv the file**

```bash
cd /Users/gego/conductor/workspaces/lumio/lyon-v1
mkdir -p apps/web/src/components/photo-grid
git mv "apps/web/src/app/(app)/photos/photo-grid.tsx" apps/web/src/components/photo-grid/photo-grid.tsx
```

- [ ] **Step 2: Update the Library importer**

In `apps/web/src/app/(app)/photos/library-view.tsx`, change:

```tsx
import { PhotoGrid } from "./photo-grid";
```

to:

```tsx
import { PhotoGrid } from "@/components/photo-grid/photo-grid";
```

- [ ] **Step 3: Update the Album importer**

In `apps/web/src/app/(app)/albums/[id]/album-view.tsx`, change:

```tsx
import { PhotoGrid } from "@/app/(app)/photos/photo-grid";
```

to:

```tsx
import { PhotoGrid } from "@/components/photo-grid/photo-grid";
```

- [ ] **Step 4: Verify**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no output. (The grid still references `@/lib/...` via the `@/` alias, which is unaffected by the move.)

---

## Task A2: Extract the data/pagination hook

**Files:**
- Create: `apps/web/src/components/photo-grid/use-photo-pages.ts`
- Modify: `apps/web/src/components/photo-grid/photo-grid.tsx`

- [ ] **Step 1: Create the hook**

Create `apps/web/src/components/photo-grid/use-photo-pages.ts`:

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PhotoDTO, PhotosPage } from "@lumio/shared";

async function fetchPage(endpoint: string, cursor: string | null): Promise<PhotosPage> {
  const params = new URLSearchParams({ limit: "50" });
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`${endpoint}?${params.toString()}`);
  if (!res.ok) throw new Error("Failed to load photos");
  return res.json();
}

/**
 * Cursor-paginated photo loading for one endpoint. Fetches the first page on
 * mount; callers drive subsequent pages via `loadMore` (e.g. when the grid
 * scrolls near the end). State resets only on remount — album views remount the
 * grid via a `key` when the album changes.
 */
export function usePhotoPages(endpoint: string) {
  const [photos, setPhotos] = useState<PhotoDTO[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(false);
  const loadingRef = useRef(false);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || done) return;
    loadingRef.current = true;
    setError(false);
    try {
      const page = await fetchPage(endpoint, cursor);
      setPhotos((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
      if (!page.nextCursor) setDone(true);
    } catch {
      setError(true);
    } finally {
      loadingRef.current = false;
    }
  }, [endpoint, cursor, done]);

  useEffect(() => {
    void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { photos, done, error, loadMore };
}
```

- [ ] **Step 2: Use the hook in the orchestrator**

In `apps/web/src/components/photo-grid/photo-grid.tsx`:

Remove the `fetchPage` function (the standalone async function near the top), and remove these state declarations and the `loadMore`/initial-load block from inside `PhotoGrid`:

```tsx
  const [photos, setPhotos] = useState<PhotoDTO[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(false);
  const loadingRef = useRef(false);
```

```tsx
  const loadMore = useCallback(async () => {
    if (loadingRef.current || done) return;
    loadingRef.current = true;
    setError(false);
    try {
      const page = await fetchPage(endpoint, cursor);
      setPhotos((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
      if (!page.nextCursor) setDone(true);
    } catch {
      setError(true);
    } finally {
      loadingRef.current = false;
    }
  }, [endpoint, cursor, done]);

  useEffect(() => {
    void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

Add this single line where those state declarations were (just after the `PhotoGrid` body opens, before `anchorRef`):

```tsx
  const { photos, done, error, loadMore } = usePhotoPages(endpoint);
```

Add the import near the other local imports:

```tsx
import { usePhotoPages } from "./use-photo-pages";
```

Then clean up now-unused imports in `photo-grid.tsx`: remove `useCallback` and `PhotosPage` if no longer referenced (keep `useEffect`, `useLayoutEffect`, `useRef`, `useState` — still used by layout/virtualizer/selection; keep `PhotoDTO` — still used in `GridThumb`/tile types).

- [ ] **Step 3: Verify**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no output.

Run: `cd apps/web && npx eslint "src/components/photo-grid/photo-grid.tsx" "src/components/photo-grid/use-photo-pages.ts"`
Expected: only the pre-existing `set-state-in-effect` errors (now: the `loadMore` effect in `use-photo-pages.ts`, and the near-end `loadMore` effect remaining in `photo-grid.tsx`). No other errors.

---

## Task A3: Extract the skeleton

**Files:**
- Create: `apps/web/src/components/photo-grid/photo-grid-skeleton.tsx`
- Modify: `apps/web/src/components/photo-grid/photo-grid.tsx`

- [ ] **Step 1: Create the skeleton component**

Create `apps/web/src/components/photo-grid/photo-grid-skeleton.tsx`:

```tsx
import { GRID_GAP, MIN_TILE } from "@/lib/grid-layout";

// Placeholder tiles rendered before the first page loads. Generous enough to
// fill a large (4K) viewport; the container clips overflow to the viewport, so
// the extras are harmless on smaller screens.
const SKELETON_TILES = 120;

/**
 * Warm-grey placeholder shown until the first page loads. Pure CSS (auto-fill
 * columns + square tiles) so it needs no measured width — it's in the server
 * HTML and paints on the first frame, even on a fast refresh before hydration.
 * auto-fill with the same MIN_TILE/GRID_GAP yields the same column count as the
 * real grid, so the swap to real photos is seamless.
 */
export function PhotoGridSkeleton({ listRef }: { listRef: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={listRef} style={{ maxHeight: "100vh", overflow: "hidden" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(auto-fill, minmax(${MIN_TILE}px, 1fr))`,
          gap: GRID_GAP,
        }}
      >
        {Array.from({ length: SKELETON_TILES }).map((_, i) => (
          <div key={i} className="aspect-square rounded-sm bg-skeleton" />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Use it in the orchestrator**

In `photo-grid.tsx`, replace the entire `if (showSkeleton) { return ( ... ); }` block with:

```tsx
  if (showSkeleton) {
    return <PhotoGridSkeleton listRef={listRef} />;
  }
```

Remove the now-unused `SKELETON_TILES` constant from `photo-grid.tsx`. Keep `MIN_TILE`/`GRID_GAP` imports only if still used elsewhere in `photo-grid.tsx` (they are: `GRID_GAP` is used in layout math and row styles; `MIN_TILE` is now only used by the skeleton — remove `MIN_TILE` from the `photo-grid.tsx` import if no longer referenced).

Add the import:

```tsx
import { PhotoGridSkeleton } from "./photo-grid-skeleton";
```

- [ ] **Step 3: Verify**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no output.

---

## Task A4: Extract the thumbnail renderer

**Files:**
- Create: `apps/web/src/components/photo-grid/photo-thumb.tsx`
- Modify: `apps/web/src/components/photo-grid/photo-grid.tsx`

- [ ] **Step 1: Create the thumb component (verbatim move + rename)**

Create `apps/web/src/components/photo-grid/photo-thumb.tsx`:

```tsx
import type { PhotoDTO } from "@lumio/shared";
import type { ThumbnailFit } from "@/lib/use-thumbnail-fit";

/**
 * One grid tile's photo. Renders the thumbnail at its *cover* size inside an
 * overflow-clipped square, then reaches "contain" by scaling DOWN to the
 * photo's short/long ratio. object-fit can't be CSS-animated, but transforms
 * can — and cover/contain are the same image at two zoom levels — so the
 * cover↔contain toggle becomes a smooth, GPU-accelerated zoom. Scaling down
 * (rather than up from contain) keeps the default cover view pixel-crisp.
 */
export function PhotoThumb({ photo, fit }: { photo: PhotoDTO; fit: ThumbnailFit }) {
  const { width: w, height: h } = photo;
  const valid = w > 0 && h > 0;
  const aspect = valid ? w / h : 1;
  const containScale = valid ? Math.min(w, h) / Math.max(w, h) : 1;
  return (
    <div className="group/tile relative h-full w-full overflow-hidden rounded-sm">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/thumbnails/${photo.id}`}
        alt={photo.path}
        loading="lazy"
        width={w}
        height={h}
        // The element is sized to the cover rectangle (long edge overflows the
        // square and is clipped); contain is the same element scaled down.
        className="absolute left-1/2 top-1/2 max-w-none rounded-sm object-cover transition-[transform,opacity] duration-300 ease-out group-hover/tile:opacity-90"
        style={{
          width: aspect >= 1 ? `${aspect * 100}%` : "100%",
          height: aspect >= 1 ? "100%" : `${(100 / aspect)}%`,
          transform: `translate(-50%, -50%) scale(${fit === "cover" ? 1 : containScale})`,
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Remove `GridThumb` from the orchestrator and import `PhotoThumb`**

In `photo-grid.tsx`, delete the entire `function GridThumb(...) { ... }` definition. Add the import:

```tsx
import { PhotoThumb } from "./photo-thumb";
```

Change the `thumb` line inside the row map from:

```tsx
                const thumb = <GridThumb photo={photo} fit={fit} />;
```

to:

```tsx
                const thumb = <PhotoThumb photo={photo} fit={fit} />;
```

- [ ] **Step 3: Verify**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no output.

---

## Task A5: Extract the tile (Link / selectable button)

**Files:**
- Create: `apps/web/src/components/photo-grid/photo-grid-tile.tsx`
- Modify: `apps/web/src/components/photo-grid/photo-grid.tsx`

- [ ] **Step 1: Create the tile component**

Create `apps/web/src/components/photo-grid/photo-grid-tile.tsx`:

```tsx
"use client";

import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import type { PhotoDTO } from "@lumio/shared";
import { photoHref } from "@/lib/photo-href";
import type { ThumbnailFit } from "@/lib/use-thumbnail-fit";
import { cn } from "@/lib/utils";
import { PhotoThumb } from "./photo-thumb";

/**
 * One grid cell. In select mode it's a toggle button with a checkbox overlay and
 * a shrink-on-select affordance; otherwise it's a Link to the photo. Both wrap
 * the same PhotoThumb.
 */
export function PhotoGridTile({
  photo,
  fit,
  albumId,
  selectMode,
  isSelected,
  index,
  onTileClick,
}: {
  photo: PhotoDTO;
  fit: ThumbnailFit;
  albumId?: string;
  selectMode: boolean;
  isSelected: boolean;
  index: number;
  onTileClick: (index: number, e: React.MouseEvent) => void;
}) {
  const thumb = <PhotoThumb photo={photo} fit={fit} />;

  if (selectMode) {
    return (
      <button
        type="button"
        aria-pressed={isSelected}
        onClick={(e) => onTileClick(index, e)}
        className={cn(
          "relative block h-full select-none rounded-sm outline-none focus:outline-none focus-visible:outline-none",
          isSelected && "ring-2 ring-inset ring-primary",
        )}
      >
        <div className={cn("h-full w-full transition-transform", isSelected && "scale-[0.92]")}>
          {thumb}
        </div>
        <span className="absolute left-2 top-2 rounded-full bg-background text-foreground">
          {isSelected ? (
            <CheckCircle2 className="size-5 text-primary" />
          ) : (
            <Circle className="size-5 text-muted-foreground" />
          )}
        </span>
      </button>
    );
  }

  return (
    <Link
      href={photoHref(photo.id, albumId)}
      className="block h-full outline-none focus:outline-none focus-visible:outline-none"
    >
      {thumb}
    </Link>
  );
}
```

- [ ] **Step 2: Use the tile in the orchestrator's row map**

In `photo-grid.tsx`, replace the entire inner `{rowPhotos.map((photo, i) => { ... })}` callback body (from `const globalIndex = ...` through the returned `<Link>`/`<button>` JSX) with:

```tsx
              {rowPhotos.map((photo, i) => (
                <PhotoGridTile
                  key={photo.id}
                  photo={photo}
                  fit={fit}
                  albumId={albumId}
                  selectMode={selectMode}
                  isSelected={selectedIds?.has(photo.id) ?? false}
                  index={start + i}
                  onTileClick={handleTileClick}
                />
              ))}
```

Add the import:

```tsx
import { PhotoGridTile } from "./photo-grid-tile";
```

Now remove imports from `photo-grid.tsx` that are only used by the extracted tile: `Link` (next/link), `CheckCircle2`, `Circle` (lucide), `photoHref`, and `cn` — **but** keep any still used in `photo-grid.tsx`. After this task, `photo-grid.tsx` no longer renders `Link`/checkbox/`cn` directly; verify each import is unused before removing. Keep `Images` (lucide) — still used by `PHOTOS_EMPTY`.

- [ ] **Step 3: Verify**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no output.

Run: `cd apps/web && npx eslint "src/components/photo-grid/"`
Expected: only the pre-existing `set-state-in-effect` errors in `use-photo-pages.ts` and `photo-grid.tsx`. No `no-unused-vars` errors (if any appear, remove that import).

Run: `cd apps/web && npm test`
Expected: all pass (no grid tests existed; lib tests unaffected).

---

## Task A6: Commit Phase A

- [ ] **Step 1: Sanity-check the final orchestrator**

Open `apps/web/src/components/photo-grid/photo-grid.tsx` and confirm it now contains: imports (react hooks, `useWindowVirtualizer`, `Images`, `PhotoDTO`, `computeColumns`/`rowCount`/`GRID_GAP`, `computeSelection`, `ThumbnailFit`, the four local modules, Empty* ui), `PHOTOS_EMPTY`, `OVERSCAN_ROWS`, and the `PhotoGrid` function (selection handler, layout effect, virtualizer, the two remaining effects, and the three render branches using `PhotoGridSkeleton` / `empty` / row-mapped `PhotoGridTile`).

- [ ] **Step 2: Commit**

```bash
cd /Users/gego/conductor/workspaces/lumio/lyon-v1
git add -A
git commit -m "$(cat <<'EOF'
refactor(web): split photo-grid into components/photo-grid

Move the grid from app/(app)/photos into a focused module: orchestrator
+ usePhotoPages (data/pagination) + PhotoGridTile + PhotoThumb +
PhotoGridSkeleton. Behavior-preserving; the cover/contain toggle is
unchanged. Importers updated.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Browser-verify (quick)**

Reload the Library and an Album. Confirm: photos load, infinite scroll works, skeleton flashes on hard refresh, select mode + shift-range + checkboxes work, clicking a tile opens the photo, and the cover/contain toggle still zooms. No visual change from before the refactor.

---

# Phase B — Feature (fill / fit / card)

**One commit at the end of Phase B.**

## Task B1: View-mode hook with migration (TDD)

**Files:**
- Move: `apps/web/src/lib/use-thumbnail-fit.ts` → `apps/web/src/lib/use-grid-view.ts`
- Create: `apps/web/src/lib/use-grid-view.test.ts`

- [ ] **Step 1: git mv the hook file**

```bash
cd /Users/gego/conductor/workspaces/lumio/lyon-v1
git mv apps/web/src/lib/use-thumbnail-fit.ts apps/web/src/lib/use-grid-view.ts
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/lib/use-grid-view.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseGridView } from "./use-grid-view";

describe("parseGridView", () => {
  it("returns a valid new-key value as-is", () => {
    expect(parseGridView("card", null)).toBe("card");
    expect(parseGridView("fill", null)).toBe("fill");
    expect(parseGridView("fit", null)).toBe("fit");
  });

  it("migrates the old thumbnail-fit key", () => {
    expect(parseGridView(null, "cover")).toBe("fill");
    expect(parseGridView(null, "contain")).toBe("fit");
  });

  it("prefers a valid new value over the old key", () => {
    expect(parseGridView("fit", "cover")).toBe("fit");
  });

  it("falls back to the old key when the new value is invalid", () => {
    expect(parseGridView("garbage", "contain")).toBe("fit");
  });

  it("defaults to fill when nothing is stored or values are unknown", () => {
    expect(parseGridView(null, null)).toBe("fill");
    expect(parseGridView("nope", "nope")).toBe("fill");
  });
});
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `cd apps/web && npx vitest run src/lib/use-grid-view.test.ts`
Expected: FAIL — `parseGridView` is not exported (the file still has the old `useThumbnailFit` content).

- [ ] **Step 4: Rewrite the hook file**

Replace the entire contents of `apps/web/src/lib/use-grid-view.ts` with:

```ts
"use client";

import { useCallback, useSyncExternalStore } from "react";

export type GridViewMode = "fill" | "fit" | "card";

const STORAGE_KEY = "lumio:grid-view";
// Previous two-state key; migrated on read so the existing preference carries over.
const LEGACY_KEY = "lumio:thumbnail-fit";

function isMode(value: string | null): value is GridViewMode {
  return value === "fill" || value === "fit" || value === "card";
}

/**
 * Resolve the stored grid view mode. Prefers a valid value under the current
 * key; otherwise migrates the legacy cover/contain toggle (cover→fill,
 * contain→fit); otherwise defaults to "fill". Pure for testability.
 */
export function parseGridView(stored: string | null, legacy: string | null): GridViewMode {
  if (isMode(stored)) return stored;
  if (legacy === "cover") return "fill";
  if (legacy === "contain") return "fit";
  return "fill";
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

function getSnapshot(): GridViewMode {
  return parseGridView(localStorage.getItem(STORAGE_KEY), localStorage.getItem(LEGACY_KEY));
}

// The server (and the first hydration pass) always assume the default; the real
// value is read on the client after mount. useSyncExternalStore swaps to the
// client snapshot without a hydration mismatch.
function getServerSnapshot(): GridViewMode {
  return "fill";
}

/**
 * Global, persisted grid view mode: "fill" (cover, edge-to-edge), "fit"
 * (contain, letterboxed), or "card" (contained on a padded surface). Persisted
 * to localStorage so the choice carries across routes and reloads, and synced
 * across tabs via the `storage` event.
 */
export function useGridView() {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setMode = useCallback((next: GridViewMode) => {
    localStorage.setItem(STORAGE_KEY, next);
    listeners.forEach((cb) => cb());
  }, []);

  return { mode, setMode };
}
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `cd apps/web && npx vitest run src/lib/use-grid-view.test.ts`
Expected: PASS (5 tests).

---

## Task B2: The view-mode dropdown menu

**Files:**
- Move: `apps/web/src/components/thumbnail-fit-toggle.tsx` → `apps/web/src/components/grid-view-menu.tsx`

- [ ] **Step 1: git mv the control file**

```bash
cd /Users/gego/conductor/workspaces/lumio/lyon-v1
git mv apps/web/src/components/thumbnail-fit-toggle.tsx apps/web/src/components/grid-view-menu.tsx
```

- [ ] **Step 2: Rewrite it as a dropdown menu**

Replace the entire contents of `apps/web/src/components/grid-view-menu.tsx` with:

```tsx
"use client";

import { ImageIcon, LayoutGrid, Maximize, Minimize } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { GridViewMode } from "@/lib/use-grid-view";

/**
 * Header control to pick the grid view mode. Mirrors the sidebar's theme picker:
 * an icon-button trigger opening a radio group (Fill / Fit / Card) with the
 * active mode checked.
 */
export function GridViewMenu({
  mode,
  onModeChange,
}: {
  mode: GridViewMode;
  onModeChange: (mode: GridViewMode) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon-sm" aria-label="Grid view" title="Grid view">
          <LayoutGrid />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuRadioGroup
          value={mode}
          onValueChange={(value) => onModeChange(value as GridViewMode)}
        >
          <DropdownMenuRadioItem value="fill">
            <Maximize aria-hidden />
            Fill
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="fit">
            <Minimize aria-hidden />
            Fit
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="card">
            <ImageIcon aria-hidden />
            Card
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 3: Note — do not run full tsc yet**

The B1 rename left every consumer of the old module with a dangling import. Mid-phase,
`tsc` reports errors in the `photo-grid` module files (`photo-thumb.tsx`,
`photo-grid-tile.tsx`, `photo-grid.tsx` — they still `import type { ThumbnailFit } from
"@/lib/use-thumbnail-fit"`) **and** in `library-view.tsx` / `album-view.tsx`. These are
resolved by Tasks B3 (module) and B4 (views); `grid-view-menu.tsx` itself compiles (its
`GridViewMode` import exists after B1). Do not commit; proceed to B3. The first clean full
`tsc` is at the end of B4.

---

## Task B3: cva cell + mode-driven thumb

**Files:**
- Create: `apps/web/src/components/photo-grid/cell-variants.ts`
- Modify: `apps/web/src/components/photo-grid/photo-thumb.tsx`
- Modify: `apps/web/src/components/photo-grid/photo-grid-tile.tsx`
- Modify: `apps/web/src/components/photo-grid/photo-grid.tsx`

- [ ] **Step 1: Create the cell cva**

Create `apps/web/src/components/photo-grid/cell-variants.ts`:

```ts
import { cva } from "class-variance-authority";

/**
 * The clickable grid cell. In `card` mode it gains a surface + padding so the
 * contained photo floats on a card (and leaves room for future label/rating/
 * title chrome); `fill` and `fit` are chrome-less. `selected` is only ever true
 * in select mode.
 */
export const cellVariants = cva(
  "relative block h-full rounded-sm outline-none transition-colors focus:outline-none focus-visible:outline-none",
  {
    variants: {
      mode: {
        fill: "",
        fit: "",
        card: "bg-muted p-2",
      },
      selected: {
        true: "ring-2 ring-inset ring-primary",
        false: "",
      },
    },
    defaultVariants: { mode: "fill", selected: false },
  },
);
```

- [ ] **Step 2: Switch `PhotoThumb` from `fit` to `mode`**

In `apps/web/src/components/photo-grid/photo-thumb.tsx`:

Change the import line:

```tsx
import type { ThumbnailFit } from "@/lib/use-thumbnail-fit";
```

to:

```tsx
import type { GridViewMode } from "@/lib/use-grid-view";
```

Change the signature and the cover decision. Replace:

```tsx
export function PhotoThumb({ photo, fit }: { photo: PhotoDTO; fit: ThumbnailFit }) {
  const { width: w, height: h } = photo;
  const valid = w > 0 && h > 0;
  const aspect = valid ? w / h : 1;
  const containScale = valid ? Math.min(w, h) / Math.max(w, h) : 1;
```

with:

```tsx
export function PhotoThumb({ photo, mode }: { photo: PhotoDTO; mode: GridViewMode }) {
  const { width: w, height: h } = photo;
  const valid = w > 0 && h > 0;
  const aspect = valid ? w / h : 1;
  const containScale = valid ? Math.min(w, h) / Math.max(w, h) : 1;
  // Only "fill" covers; "fit" and "card" show the whole photo (contained).
  const cover = mode === "fill";
```

And change the transform line:

```tsx
          transform: `translate(-50%, -50%) scale(${fit === "cover" ? 1 : containScale})`,
```

to:

```tsx
          transform: `translate(-50%, -50%) scale(${cover ? 1 : containScale})`,
```

- [ ] **Step 3: Switch `PhotoGridTile` to `mode` + cva**

In `apps/web/src/components/photo-grid/photo-grid-tile.tsx`:

Replace the import line:

```tsx
import type { ThumbnailFit } from "@/lib/use-thumbnail-fit";
```

with:

```tsx
import type { GridViewMode } from "@/lib/use-grid-view";
import { cellVariants } from "./cell-variants";
```

Change the prop `fit: ThumbnailFit` to `mode: GridViewMode` in both the destructure and the type, and the thumb line. Replace the whole component body so it uses `mode` and `cellVariants`:

```tsx
export function PhotoGridTile({
  photo,
  mode,
  albumId,
  selectMode,
  isSelected,
  index,
  onTileClick,
}: {
  photo: PhotoDTO;
  mode: GridViewMode;
  albumId?: string;
  selectMode: boolean;
  isSelected: boolean;
  index: number;
  onTileClick: (index: number, e: React.MouseEvent) => void;
}) {
  const thumb = <PhotoThumb photo={photo} mode={mode} />;

  if (selectMode) {
    return (
      <button
        type="button"
        aria-pressed={isSelected}
        onClick={(e) => onTileClick(index, e)}
        className={cn(cellVariants({ mode, selected: isSelected }), "select-none")}
      >
        <div className={cn("h-full w-full transition-transform", isSelected && "scale-[0.92]")}>
          {thumb}
        </div>
        <span className="absolute left-2 top-2 rounded-full bg-background text-foreground">
          {isSelected ? (
            <CheckCircle2 className="size-5 text-primary" />
          ) : (
            <Circle className="size-5 text-muted-foreground" />
          )}
        </span>
      </button>
    );
  }

  return (
    <Link href={photoHref(photo.id, albumId)} className={cellVariants({ mode })}>
      {thumb}
    </Link>
  );
}
```

- [ ] **Step 4: Switch `PhotoGrid` prop `fit` → `mode`**

In `apps/web/src/components/photo-grid/photo-grid.tsx`:

Change the import:

```tsx
import type { ThumbnailFit } from "@/lib/use-thumbnail-fit";
```

to:

```tsx
import type { GridViewMode } from "@/lib/use-grid-view";
```

In the `PhotoGrid` props destructure and type, replace `fit = "cover"` / `fit?: ThumbnailFit;` with `mode = "fill"` / `mode?: GridViewMode;`.

In the row map, change the tile prop from `fit={fit}` to `mode={mode}`:

```tsx
                <PhotoGridTile
                  key={photo.id}
                  photo={photo}
                  mode={mode}
                  albumId={albumId}
                  selectMode={selectMode}
                  isSelected={selectedIds?.has(photo.id) ?? false}
                  index={start + i}
                  onTileClick={handleTileClick}
                />
```

- [ ] **Step 5: Verify**

Run: `cd apps/web && npx tsc --noEmit`
Expected: errors only remain in `library-view.tsx` / `album-view.tsx` (fixed next).

---

## Task B4: Wire the views to the new hook + menu

**Files:**
- Modify: `apps/web/src/app/(app)/photos/library-view.tsx`
- Modify: `apps/web/src/app/(app)/albums/[id]/album-view.tsx`

- [ ] **Step 1: Update Library view**

In `apps/web/src/app/(app)/photos/library-view.tsx`:

Replace the two imports:

```tsx
import { useThumbnailFit } from "@/lib/use-thumbnail-fit";
import { ThumbnailFitToggle } from "@/components/thumbnail-fit-toggle";
```

with:

```tsx
import { useGridView } from "@/lib/use-grid-view";
import { GridViewMenu } from "@/components/grid-view-menu";
```

Replace the hook call:

```tsx
  const { fit, toggle } = useThumbnailFit();
```

with:

```tsx
  const { mode, setMode } = useGridView();
```

Replace the toggle in the header actions:

```tsx
              <ThumbnailFitToggle fit={fit} onToggle={toggle} />
```

with:

```tsx
              <GridViewMenu mode={mode} onModeChange={setMode} />
```

Replace the grid prop:

```tsx
      <PhotoGrid
        fit={fit}
```

with:

```tsx
      <PhotoGrid
        mode={mode}
```

- [ ] **Step 2: Update Album view**

In `apps/web/src/app/(app)/albums/[id]/album-view.tsx`, make the identical replacements:

- imports `useThumbnailFit`/`ThumbnailFitToggle` → `useGridView`/`GridViewMenu`
- `const { fit, toggle } = useThumbnailFit();` → `const { mode, setMode } = useGridView();`
- `<ThumbnailFitToggle fit={fit} onToggle={toggle} />` → `<GridViewMenu mode={mode} onModeChange={setMode} />`
- the `<PhotoGrid ... fit={fit} ...>` prop → `mode={mode}`

- [ ] **Step 3: Verify everything**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no output.

Run: `cd apps/web && npx eslint "src/components/grid-view-menu.tsx" "src/lib/use-grid-view.ts" "src/components/photo-grid/" "src/app/(app)/photos/library-view.tsx" "src/app/(app)/albums/[id]/album-view.tsx"`
Expected: only the pre-existing `set-state-in-effect` errors in `use-photo-pages.ts` and `photo-grid.tsx`. No unused-import errors, no references to the deleted `use-thumbnail-fit` / `thumbnail-fit-toggle`.

Run: `cd apps/web && npm test`
Expected: all pass, including the new `use-grid-view.test.ts` (5 tests).

Run: `cd /Users/gego/conductor/workspaces/lumio/lyon-v1 && grep -rn "thumbnail-fit\|ThumbnailFit\|useThumbnailFit" apps/web/src`
Expected: no matches (everything renamed).

---

## Task B5: Browser-verify and commit Phase B

- [ ] **Step 1: Browser-verify**

In both Library and an Album header, the `LayoutGrid` icon button now opens a menu with **Fill / Fit / Card** and the active one checked. Verify:
- **Fill** = cover, edge-to-edge (default).
- **Fit** = contain, letterboxed on the page background.
- **Card** = each photo contained on a grey (`bg-muted`) padded card.
- Choosing a mode persists across reload, applies on both Library and Album, and (if you previously had the cover/contain toggle on "contain") migrates to **Fit** on first load.
- fill ↔ fit still zooms smoothly; select mode (ring, checkbox, 0.92 shrink) works in all three modes, including card.

- [ ] **Step 2: Commit**

```bash
cd /Users/gego/conductor/workspaces/lumio/lyon-v1
git add -A
git commit -m "$(cat <<'EOF'
feat(web): add card grid view mode + view-mode menu

Generalize the cover/contain toggle into a 3-way grid view mode
(fill/fit/card) chosen from a dropdown menu that mirrors the sidebar's
theme picker. Card mode renders each photo contained on a padded
bg-muted surface, leaving room for future color labels / ratings /
titles. useThumbnailFit → useGridView with localStorage migration
(cover→fill, contain→fit); thumbnail-fit-toggle → grid-view-menu.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review notes (author)

- **Spec coverage:** model enum (B1), migration (B1 + test), dropdown menu matching sidebar
  (B2), refactor file split incl. cva (A1–A5, B3), card rendering bg-muted+padding+contain
  (B3 cell-variants + photo-thumb), transitions preserved (photo-thumb unchanged transition;
  cell `transition-colors`), commit sequence (A6, B5). No metadata built (YAGNI) — only the
  card surface + a comment-marked future slot.
- **Type consistency:** `GridViewMode` used uniformly across `use-grid-view.ts`,
  `grid-view-menu.tsx`, `cell-variants.ts`, `photo-thumb.tsx`, `photo-grid-tile.tsx`,
  `photo-grid.tsx`. Hook returns `{ mode, setMode }`; menu props `{ mode, onModeChange }`;
  grid prop `mode`. `parseGridView(stored, legacy)` signature matches its test.
- **Deviation from spec:** `cell-variants.ts` (cva) is introduced in Phase B (where the
  `mode` axis first exists) rather than Phase A, to avoid a thin premature abstraction —
  Phase A keeps verbatim className strings. Noted here intentionally.
