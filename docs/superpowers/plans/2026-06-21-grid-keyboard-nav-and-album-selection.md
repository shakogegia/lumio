# Grid keyboard nav + album/folder selection parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `/albums` listing the same click-selection model as the photo grid, and add arrow-key navigation that moves the selection across both the photo grid and the album/folder listing.

**Architecture:** Two pure, unit-tested helpers (`nextGridIndex`, `arrowSelection`) live next to the existing `computeSelection` in `grid-selection.ts`. A shared client hook `useGridSelectionNav` owns the shift **anchor** and keyboard **lead/cursor** refs, exposes a `handleItemClick` for mouse selection, and installs one guarded `keydown` listener for arrows + Enter. Both `photo-grid.tsx` (virtualized) and `folder-browser.tsx` (plain DOM) consume the hook; the album/folder cards switch from `onToggle(id)` to `onSelect(id, event)`.

**Tech Stack:** Next.js (App Router), React 19 + React Compiler, TypeScript, `@tanstack/react-virtual`, Vitest (node env — pure-logic tests only; components verified in the browser).

---

## File structure

**Modify**
- `apps/web/src/lib/grid-selection.ts` — add `ArrowKey`, `nextGridIndex`, `arrowSelection`.
- `apps/web/src/lib/grid-selection.test.ts` — add tests for the two new helpers.
- `apps/web/src/lib/use-grid-selection.ts` — use the shared key-guard for its Escape handler.
- `apps/web/src/components/photo-grid/photo-grid.tsx` — replace inline click/anchor logic with the hook; wire `scrollToIndex` to the virtualizer.
- `apps/web/src/app/(app)/albums/folder-browser.tsx` — flat id list, use the hook, pass `onSelect`/scroll, Enter-opens.
- `apps/web/src/app/(app)/albums/album-card.tsx` — `onToggle` → `onSelect(id, event)`; intercept ⌘/Ctrl; `data-card-id`.
- `apps/web/src/app/(app)/albums/folder-card.tsx` — same as album-card.

**Create**
- `apps/web/src/lib/grid-key-guard.ts` — `keyboardTargetBlocked(target)` shared by Escape + arrow handlers.
- `apps/web/src/lib/use-grid-selection-nav.ts` — the shared mouse+keyboard hook.

**Behavior note (call out in the PR):** on `/photos`, album detail, and `/albums`, arrow keys now drive grid selection instead of scrolling the page (wheel/trackpad scrolling is unaffected). This matches Finder / Apple Photos.

---

## Task 1: `nextGridIndex` pure helper

**Files:**
- Modify: `apps/web/src/lib/grid-selection.ts`
- Test: `apps/web/src/lib/grid-selection.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the top of `grid-selection.test.ts` (after the existing import line, keep the existing `import { computeSelection } ...` — extend it):

```ts
import { arrowSelection, computeSelection, nextGridIndex } from "./grid-selection.js";
```

Append this `describe` block to the end of the file:

```ts
describe("nextGridIndex", () => {
  // 5 items, 3 columns:  [0 1 2 / 3 4]
  it("lands on the first item when nothing is focused yet", () => {
    expect(nextGridIndex(null, "ArrowDown", 3, 5)).toBe(0);
    expect(nextGridIndex(null, "ArrowUp", 3, 5)).toBe(0);
  });

  it("moves one column left/right and clamps at the row/grid edges", () => {
    expect(nextGridIndex(1, "ArrowLeft", 3, 5)).toBe(0);
    expect(nextGridIndex(1, "ArrowRight", 3, 5)).toBe(2);
    expect(nextGridIndex(0, "ArrowLeft", 3, 5)).toBe(0); // already first
    expect(nextGridIndex(4, "ArrowRight", 3, 5)).toBe(4); // already last
  });

  it("moves one row up/down by the column count", () => {
    expect(nextGridIndex(3, "ArrowUp", 3, 5)).toBe(0);
    expect(nextGridIndex(0, "ArrowDown", 3, 5)).toBe(3);
  });

  it("clamps vertical moves that would leave the grid", () => {
    expect(nextGridIndex(1, "ArrowUp", 3, 5)).toBe(1); // top row, no row above
    expect(nextGridIndex(4, "ArrowDown", 3, 5)).toBe(4); // no row below (index 7 absent)
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/web && npx vitest run src/lib/grid-selection.test.ts`
Expected: FAIL — `nextGridIndex is not a function` (and `arrowSelection` import unresolved).

- [ ] **Step 3: Implement `nextGridIndex`**

Add to `apps/web/src/lib/grid-selection.ts` (above `computeSelection`):

```ts
export type ArrowKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

/**
 * Clamped neighbor index for an arrow key in a `columns`-wide grid of `count`
 * items. A null cursor (nothing focused yet) lands on the first item. Movement
 * never wraps: a blocked move returns the current index unchanged.
 */
export function nextGridIndex(
  current: number | null,
  key: ArrowKey,
  columns: number,
  count: number,
): number {
  if (count <= 0) return 0;
  if (current === null) return 0;
  const i = Math.min(Math.max(current, 0), count - 1);
  switch (key) {
    case "ArrowLeft":
      return i > 0 ? i - 1 : i;
    case "ArrowRight":
      return i < count - 1 ? i + 1 : i;
    case "ArrowUp":
      return i - columns >= 0 ? i - columns : i;
    case "ArrowDown":
      return i + columns < count ? i + columns : i;
  }
}
```

- [ ] **Step 4: Run the `nextGridIndex` tests (the `arrowSelection` ones still fail)**

Run: `cd apps/web && npx vitest run src/lib/grid-selection.test.ts -t nextGridIndex`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/grid-selection.ts apps/web/src/lib/grid-selection.test.ts
git commit -m "feat(web): nextGridIndex helper for arrow-key grid navigation"
```

---

## Task 2: `arrowSelection` pure helper

**Files:**
- Modify: `apps/web/src/lib/grid-selection.ts`
- Test: `apps/web/src/lib/grid-selection.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `grid-selection.test.ts`:

```ts
describe("arrowSelection", () => {
  const idAt = (i: number) => IDS[i]; // IDS = ["a","b","c","d","e"]

  it("selects only the cursor item on a plain arrow move", () => {
    expect([...arrowSelection(idAt, 2, false, 0)]).toEqual(["c"]);
  });

  it("selects the inclusive range from anchor to cursor on shift+arrow", () => {
    expect([...arrowSelection(idAt, 3, true, 1)].sort()).toEqual(["b", "c", "d"]);
  });

  it("shrinks the range as the cursor moves back toward the anchor", () => {
    expect([...arrowSelection(idAt, 2, true, 1)].sort()).toEqual(["b", "c"]);
  });

  it("treats shift with no anchor as a single select", () => {
    expect([...arrowSelection(idAt, 2, true, null)]).toEqual(["c"]);
  });

  it("returns an empty set when the cursor id is not loaded", () => {
    const sparse = (i: number) => (i === 2 ? undefined : IDS[i]);
    expect([...arrowSelection(sparse, 2, false, null)]).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/web && npx vitest run src/lib/grid-selection.test.ts -t arrowSelection`
Expected: FAIL — `arrowSelection is not a function`.

- [ ] **Step 3: Implement `arrowSelection`**

Add to `apps/web/src/lib/grid-selection.ts` (below `computeSelection`):

```ts
/**
 * Selection after an arrow move to `leadIndex`. Shift extends the inclusive
 * range from the anchor (replace-with-range, so it grows and shrinks as the
 * cursor moves); a plain move selects only the cursor. Holes (unloaded indices,
 * via a sparse `idAt`) are skipped. `idAt` lets the virtualized photo grid avoid
 * materializing a full id array on every keystroke.
 */
export function arrowSelection(
  idAt: (index: number) => string | undefined,
  leadIndex: number,
  shift: boolean,
  anchorIndex: number | null,
): Set<string> {
  if (shift && anchorIndex !== null) {
    const lo = Math.min(anchorIndex, leadIndex);
    const hi = Math.max(anchorIndex, leadIndex);
    const next = new Set<string>();
    for (let i = lo; i <= hi; i++) {
      const id = idAt(i);
      if (id) next.add(id);
    }
    return next;
  }
  const id = idAt(leadIndex);
  return id ? new Set([id]) : new Set();
}
```

- [ ] **Step 4: Run the full selection test file**

Run: `cd apps/web && npx vitest run src/lib/grid-selection.test.ts`
Expected: PASS (all `computeSelection`, `nextGridIndex`, and `arrowSelection` tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/grid-selection.ts apps/web/src/lib/grid-selection.test.ts
git commit -m "feat(web): arrowSelection helper for keyboard range selection"
```

---

## Task 3: Shared keyboard-target guard

**Files:**
- Create: `apps/web/src/lib/grid-key-guard.ts`
- Modify: `apps/web/src/lib/use-grid-selection.ts`

No unit test (touches `document`; vitest runs in node). It is an extraction of logic already shipped and working in the Escape handler.

- [ ] **Step 1: Create the guard**

Create `apps/web/src/lib/grid-key-guard.ts`:

```ts
/**
 * True when a global selection key (Escape, arrows, Enter) should be ignored
 * because the user is typing in a field or an overlay (dialog / menu) owns the
 * keyboard. Shared by the grid's Escape-to-clear and arrow-nav handlers so they
 * stay in lockstep.
 */
export function keyboardTargetBlocked(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (el?.isContentEditable || el?.closest("input, textarea, select")) return true;
  return !!document.querySelector(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]',
  );
}
```

- [ ] **Step 2: Use it in the Escape handler**

In `apps/web/src/lib/use-grid-selection.ts`, add the import after the existing react import:

```ts
import { keyboardTargetBlocked } from "./grid-key-guard";
```

Replace the body of the `onKey` handler (the `target` lookup + the two `if` guards) so it reads:

```ts
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (keyboardTargetBlocked(e.target)) return;
      e.preventDefault();
      clear();
    };
```

- [ ] **Step 3: Verify nothing broke**

Run: `cd apps/web && npx vitest run && npm run lint 2>&1 | grep -E "grid-key-guard|use-grid-selection" || echo "clean"`
Expected: tests PASS; no lint errors in the two files.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/grid-key-guard.ts apps/web/src/lib/use-grid-selection.ts
git commit -m "refactor(web): share the grid keyboard-target guard"
```

---

## Task 4: `useGridSelectionNav` hook

**Files:**
- Create: `apps/web/src/lib/use-grid-selection-nav.ts`

No unit test (React + `document`); correctness rests on the tested helpers and the browser pass in Task 7.

- [ ] **Step 1: Create the hook**

Create `apps/web/src/lib/use-grid-selection-nav.ts`:

```ts
"use client";

import { useCallback, useEffect, useRef } from "react";
import type React from "react";
import {
  arrowSelection,
  computeSelection,
  nextGridIndex,
  type ArrowKey,
} from "./grid-selection";
import { keyboardTargetBlocked } from "./grid-key-guard";

const ARROW_KEYS = new Set<string>(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);

type NavState = {
  /** Total item count (virtualized grids include not-yet-loaded items). */
  count: number;
  columns: number;
  /** Id at an index, or undefined if not loaded. Used for keyboard selection. */
  idAt: (index: number) => string | undefined;
  /** Ordered ids for click selection (shift-range math). */
  getClickIds: () => string[];
  selectedIds: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  /** Open the item at an index (Enter / nav). Omit where there is no target. */
  onOpen?: (index: number) => void;
  /** Bring the item at an index into view after a keyboard move. */
  scrollToIndex?: (index: number) => void;
};

/**
 * Shared mouse + keyboard selection driver for a grid of `count` items laid out
 * in `columns`. Plain click / arrow selects one item; ⌘/Ctrl click toggles;
 * shift click / arrow extends a range from the anchor; Enter opens the cursor
 * item. The anchor (range origin) and lead (cursor) are kept in sync across both
 * input methods, so clicking and then arrowing feels continuous.
 */
export function useGridSelectionNav(state: NavState) {
  // Latest props for the once-registered keydown listener and the stable click
  // handler. Updated in an effect (never during render) per the refs lint rule.
  const ref = useRef(state);
  useEffect(() => {
    ref.current = state;
  });

  const anchorRef = useRef<number | null>(null); // fixed end of a shift range
  const leadRef = useRef<number | null>(null); // moving cursor

  // Clear the anchor + cursor whenever the selection empties (Escape, the
  // toolbar's clear, or a bulk action) so the next interaction starts fresh.
  const empty = state.selectedIds.size === 0;
  useEffect(() => {
    if (empty) {
      anchorRef.current = null;
      leadRef.current = null;
    }
  }, [empty]);

  const handleItemClick = useCallback((index: number, e: React.MouseEvent) => {
    const s = ref.current;
    if (!s.onSelectionChange) return;
    const toggle = e.metaKey || e.ctrlKey;
    const next = computeSelection(
      s.selectedIds,
      s.getClickIds(),
      index,
      { shift: e.shiftKey, toggle },
      anchorRef.current,
    );
    if (!e.shiftKey) anchorRef.current = index;
    leadRef.current = index;
    s.onSelectionChange(next);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = ref.current;
      if (!s.onSelectionChange || s.count <= 0) return;
      if (keyboardTargetBlocked(e.target)) return;

      if (e.key === "Enter") {
        if (leadRef.current !== null && s.onOpen) {
          e.preventDefault();
          s.onOpen(leadRef.current);
        }
        return;
      }
      if (!ARROW_KEYS.has(e.key)) return;
      e.preventDefault();

      const lead = nextGridIndex(leadRef.current, e.key as ArrowKey, s.columns, s.count);
      leadRef.current = lead;
      // A plain move re-anchors; the first shift move (no anchor yet) anchors in
      // place so subsequent shift moves extend a range.
      if (!e.shiftKey) anchorRef.current = lead;
      else if (anchorRef.current === null) anchorRef.current = lead;

      // Only (re)select when the target is loaded; arrowing into a not-yet
      // loaded virtualized cell still moves + scrolls so the cell can load.
      if (s.idAt(lead) !== undefined) {
        s.onSelectionChange(arrowSelection(s.idAt, lead, e.shiftKey, anchorRef.current));
      }
      s.scrollToIndex?.(lead);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return { handleItemClick };
}
```

- [ ] **Step 2: Type/lint check**

Run: `cd apps/web && npm run lint 2>&1 | grep -E "use-grid-selection-nav" || echo "clean"`
Expected: `clean`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/use-grid-selection-nav.ts
git commit -m "feat(web): useGridSelectionNav — shared mouse + keyboard grid selection"
```

---

## Task 5: Wire the hook into the photo grid

**Files:**
- Modify: `apps/web/src/components/photo-grid/photo-grid.tsx`

- [ ] **Step 1: Import the hook**

Replace the `computeSelection` import line:

```ts
import { computeSelection } from "@/lib/grid-selection";
```

with:

```ts
import { useGridSelectionNav } from "@/lib/use-grid-selection-nav";
```

- [ ] **Step 2: Remove the old click handler + anchor effect**

Delete the `anchorRef` declaration (`// Index of the last plain-clicked tile...` + `const anchorRef = useRef<number | null>(null);`), the entire `handleTileClick` function, and the anchor-reset block (`const selectedCount = ...` through its `useEffect`). Leave `handleTilesTrashed` intact.

- [ ] **Step 3: Add the hook after the virtualizer is created**

Immediately after the `const virtualizer = useWindowVirtualizer({...});` block, add:

```ts
  const { handleItemClick } = useGridSelectionNav({
    count: total ?? 0,
    columns,
    idAt: (i) => photoAt(i)?.id,
    getClickIds: getLoadedIds,
    selectedIds: selectedIds ?? EMPTY_SELECTION,
    onSelectionChange,
    onOpen: enableLightbox ? open : undefined,
    scrollToIndex: (i) => virtualizer.scrollToIndex(Math.floor(i / columns)),
  });
```

Add a module-level constant near the top of the file (after the imports):

```ts
const EMPTY_SELECTION: Set<string> = new Set();
```

- [ ] **Step 4: Point the tile at the hook's handler**

In the `<PhotoGridTile ... onTileClick={handleTileClick} />` usage, rename the prop value to `onTileClick={handleItemClick}`.

- [ ] **Step 5: Verify build + tests + lint**

Run: `cd apps/web && npx vitest run && npm run lint 2>&1 | grep -E "photo-grid.tsx" || echo "clean"`
Expected: tests PASS; `clean`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/photo-grid/photo-grid.tsx
git commit -m "feat(web): arrow-key navigation in the photo grid"
```

---

## Task 6: Wire the hook into the album/folder listing

**Files:**
- Modify: `apps/web/src/app/(app)/albums/album-card.tsx`
- Modify: `apps/web/src/app/(app)/albums/folder-card.tsx`
- Modify: `apps/web/src/app/(app)/albums/folder-browser.tsx`

- [ ] **Step 1: Update `album-card.tsx`**

Change the doc comment's first two sentences to:

```
 * One album in the listing grid. Plain left click selects only it; ⌘ (Mac) /
 * Ctrl (Windows) click toggles it into a multi-selection; shift click extends a
 * range; double click opens it; middle click opens the native link (new tab).
```

In the props type, replace `onToggle: (id: string) => void;` with:

```ts
  onSelect: (id: string, e: React.MouseEvent) => void;
```

(No React import is needed — this codebase uses the `React.*` namespace globally in `.tsx` files, e.g. `photo-grid.tsx`.)

Replace the `<a>`'s `onClick` with:

```tsx
          data-card-id={album.id}
          onClick={(e) => {
            // Middle/aux click opens the native link (new tab); every left click
            // selects: plain = only this, ⌘/Ctrl = toggle, shift = range.
            if (e.button !== 0) return;
            e.preventDefault();
            onSelect(album.id, e);
          }}
```

(The `data-card-id` goes on the same `<a>`; keep `href`, `onDoubleClick`, `className`.)

- [ ] **Step 2: Update `folder-card.tsx`**

Identical change: doc comment first two sentences →

```
 * One folder in the listing grid. Plain left click selects only it; ⌘ (Mac) /
 * Ctrl (Windows) click toggles it into a multi-selection; shift click extends a
 * range; double click opens it; middle click opens the native link (new tab).
```

Replace `onToggle: (id: string) => void;` with `onSelect: (id: string, e: React.MouseEvent) => void;` (no React import needed, same as album-card), and replace the `<a>`'s `onClick` with the `data-card-id={folder.id}` + handler form (using `folder.id`):

```tsx
          data-card-id={folder.id}
          onClick={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            onSelect(folder.id, e);
          }}
```

- [ ] **Step 3: Rewire `folder-browser.tsx` selection**

Add imports:

```ts
import { useRef } from "react";
import { useGridSelectionNav } from "@/lib/use-grid-selection-nav";
```

(Merge `useRef` into the existing `import { useState } from "react";` → `import { useRef, useState } from "react";`.)

After the `const selectedAlbumIds = ...` line (so `folderIdSet` is already declared), add the ordered id list, the index map, the open dispatcher, the container ref, and the hook:

```ts
  // Reading order across the three sections — the flat list the selection
  // reducer and arrow-key navigation index against.
  const orderedIds = [
    ...subfolders.map((f) => f.id),
    ...regular.map((a) => a.id),
    ...smart.map((a) => a.id),
  ];
  const indexOf = new Map(orderedIds.map((id, i) => [id, i]));

  const gridRef = useRef<HTMLDivElement>(null);

  function openItem(id: string) {
    if (folderIdSet.has(id)) openFolder(id);
    else openAlbum(id);
  }

  const { handleItemClick } = useGridSelectionNav({
    count: orderedIds.length,
    columns,
    idAt: (i) => orderedIds[i],
    getClickIds: () => orderedIds,
    selectedIds: sel.selected,
    onSelectionChange: sel.setSelected,
    onOpen: (i) => orderedIds[i] && openItem(orderedIds[i]),
    scrollToIndex: (i) => {
      const id = orderedIds[i];
      if (id) gridRef.current?.querySelector(`[data-card-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
    },
  });

  function onCardSelect(id: string, e: React.MouseEvent) {
    const i = indexOf.get(id);
    if (i !== undefined) handleItemClick(i, e);
  }
```

Delete the now-unused `toggle` function.

- [ ] **Step 4: Pass the container ref + new card prop**

Change the wrapping `<div className="space-y-8">` to `<div ref={gridRef} className="space-y-8">`.

In all three `.map(...)` blocks (`FolderCard`, the two `AlbumCard`), replace `onToggle={toggle}` with `onSelect={onCardSelect}`.

- [ ] **Step 5: Verify build + tests + lint**

Run: `cd apps/web && npx vitest run && npm run lint 2>&1 | grep -E "album-card|folder-card|folder-browser" || echo "clean"`
Expected: tests PASS; `clean`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/\(app\)/albums/album-card.tsx apps/web/src/app/\(app\)/albums/folder-card.tsx apps/web/src/app/\(app\)/albums/folder-browser.tsx
git commit -m "feat(web): single-click select + arrow-key nav on the albums listing"
```

---

## Task 7: Whole-app verification

**Files:** none (verification only)

- [ ] **Step 1: Full test + lint sweep**

Run: `cd apps/web && npx vitest run && npm run lint`
Expected: all tests PASS; lint reports only the pre-existing `use-async-job.ts` errors (no new errors in any file touched here).

- [ ] **Step 2: Browser pass (dev server)**

Start the app and verify on three surfaces:

- `/photos`: plain click selects one; ⌘/Ctrl-click toggles; shift-click ranges; arrow keys move the single selection (←/→/↑/↓), scrolling offscreen targets into view; shift+arrow grows/shrinks the range; Enter opens the lightbox; Escape clears. Confirm a ⌘-click no longer opens a new tab, but middle-click still does.
- An album detail page (`/albums/[id]`): same as `/photos` (it shares `PhotoGrid`).
- `/albums`: plain click selects one card; ⌘/Ctrl-click toggles; shift-click ranges across the Folders → Albums → Smart Albums order; arrow keys move selection across sections; Enter opens the selected album/folder; double-click still opens; the selection toolbar's actions (move/delete/rename) still work.

- [ ] **Step 3: Confirm overlays still own the keyboard**

With the lightbox open on `/photos`, arrow keys drive the lightbox (not the grid behind it). With a rename dialog or a context menu open on `/albums`, arrows/Enter/Escape act on the overlay, not the grid.

---

## Self-review notes

- **Spec coverage:** Part 1 (card click semantics) → Task 6; arrow-nav model → Tasks 1–2 (helpers), 4 (hook), 5–6 (both surfaces); cursor/anchor model → Task 4; shared guard → Task 3; edge cases (holes, section boundaries, empty grid) → handled in Tasks 1/2/4 and verified in Task 7.
- **Out of scope** (upload grid, Home/End/PageUp/Down, pixel-accurate cross-section vertical tracking) is intentionally untouched.
