# Grid click-to-select, double-click-to-open — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a single click select a grid item (blue outer ring, no checkmark) and a double click open its detail, removing the modal "select mode" toggle from every grid (photos, albums, uploads) — Trash stays as-is.

**Architecture:** Selection is always available. Each tile becomes one element that toggles selection on a plain left click and opens the detail on double click; ⌘/Ctrl/middle click falls through to the native link (open in new tab). A double click fires two `click` events first — they toggle the same tile twice (net no-op), then `dblclick` opens — so prior selection is preserved with no timers (the "net-zero" approach). Toolbars stop gating on a `selectMode` flag and instead show selection actions whenever `count > 0`.

**Tech Stack:** Next.js (App Router, React client components), TypeScript, Tailwind (CVA for cell variants), Vitest (node env — pure-function unit tests only; components/hooks are not rendered in the suite). Package: `@lumio/web`, run via `pnpm --filter @lumio/web ...`.

**Verification commands (used throughout):**
- Typecheck: `pnpm --filter @lumio/web exec tsc --noEmit` → exits 0, no output
- Lint: `pnpm --filter @lumio/web lint` → exits 0, no errors
- Unit tests: `pnpm --filter @lumio/web test` → all files pass

**Ordering note (why tasks land green):** The shared `useGridSelection` hook keeps exporting `selectMode`/`enter`/`cancel` until Task 6. Photo views migrate off them in Task 3, albums in Task 4, uploads in Task 5; the now-unused exports are removed last (Task 6) so every intermediate commit typechecks.

---

### Task 1: Lock the double-click net-zero invariant (regression guard)

The double-click design relies on `computeSelection` toggling the same tile twice being a no-op. `computeSelection` already implements this; this test documents and guards it. It passes against current code (no implementation change).

**Files:**
- Test: `apps/web/src/lib/grid-selection.test.ts`

- [ ] **Step 1: Add the invariant test**

Append inside the `describe("computeSelection", ...)` block in `apps/web/src/lib/grid-selection.test.ts`, after the last `it(...)`:

```ts
  it("nets to a no-op when the same tile is toggled twice (double-click invariant)", () => {
    // A double-click fires two plain clicks before the detail opens; toggling the
    // same tile twice must leave the selection exactly as it started.
    const start = new Set(["a", "c"]);
    const once = computeSelection(start, IDS, 2, false, null); // "c" off
    const twice = computeSelection(once, IDS, 2, false, null); // "c" back on
    expect([...twice].sort()).toEqual(["a", "c"]);
  });
```

- [ ] **Step 2: Run the test file**

Run: `pnpm --filter @lumio/web test src/lib/grid-selection.test.ts`
Expected: PASS (6 tests pass).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/grid-selection.test.ts
git commit -m "test(grid): guard double-click net-zero selection invariant"
```

---

### Task 2: Blue outer ring for the selected cell

**Files:**
- Modify: `apps/web/src/components/photo-grid/cell-variants.ts`

- [ ] **Step 1: Swap the selected ring style + update the comment**

In `apps/web/src/components/photo-grid/cell-variants.ts`, replace the doc comment's last sentence and the `selected` variant.

Replace this comment line:

```ts
 * title chrome); `fill` and `fit` are chrome-less. `selected` is only ever true
 * in select mode.
```

with:

```ts
 * title chrome); `fill` and `fit` are chrome-less. `selected` shows a blue outer
 * ring (selection is always available — there is no separate select mode).
```

Replace this block:

```ts
      selected: {
        true: "ring-2 ring-inset ring-primary",
        false: "",
      },
```

with:

```ts
      selected: {
        true: "ring-2 ring-offset-2 ring-offset-background ring-blue-500",
        false: "",
      },
```

- [ ] **Step 2: Typecheck, lint**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: exits 0.
Run: `pnpm --filter @lumio/web lint`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/photo-grid/cell-variants.ts
git commit -m "feat(grid): blue outer ring for selected cells"
```

---

### Task 3: Photo grids — click selects, double-click opens (Library/Album/Search/Trash)

Rewrites the photo tile to one always-selectable `<a>`, drops the `selectMode` prop from `PhotoGrid`/`PhotoGridTile`, and switches the four photo-view toolbars from `sel.selectMode` to `sel.count > 0` (and `sel.cancel` → `sel.clear`). The `useGridSelection` hook is unchanged here (albums/uploads still use its old API until Tasks 4–5).

**Files:**
- Rewrite: `apps/web/src/components/photo-grid/photo-grid-tile.tsx`
- Modify: `apps/web/src/components/photo-grid/photo-grid.tsx`
- Modify: `apps/web/src/app/(app)/photos/library-view.tsx`
- Modify: `apps/web/src/app/(app)/albums/[id]/album-view.tsx`
- Modify: `apps/web/src/app/(app)/search/search-view.tsx`
- Modify: `apps/web/src/app/(app)/trash/trash-view.tsx`

- [ ] **Step 1: Rewrite `photo-grid-tile.tsx`**

Replace the entire contents of `apps/web/src/components/photo-grid/photo-grid-tile.tsx` with:

```tsx
"use client";

import { colorLabelHex, type PhotoDTO, type PhotoSort } from "@lumio/shared";
import { photoHref } from "@/lib/photo-href";
import type { GridViewMode } from "@/lib/use-grid-view";
import { cn } from "@/lib/utils";
import { cellVariants } from "./cell-variants";
import { PhotoThumb } from "./photo-thumb";

/**
 * One grid cell. Selection is always available: a plain left click toggles the
 * tile (shift-click extends a range); a double click opens the detail. ⌘/Ctrl/
 * middle click falls through to the native link, so the photo opens in a new tab.
 * When the collection has no detail view (e.g. Trash, where `onOpen` is absent)
 * there is no href and double click is a no-op — the tile is select-only.
 */
export function PhotoGridTile({
  photo,
  mode,
  albumId,
  sort,
  onOpen,
  urlForId,
  isSelected,
  index,
  onTileClick,
}: {
  photo: PhotoDTO;
  mode: GridViewMode;
  albumId?: string;
  sort?: PhotoSort;
  onOpen?: (index: number) => void;
  urlForId?: (id: string) => string;
  isSelected: boolean;
  index: number;
  onTileClick: (index: number, e: React.MouseEvent) => void;
}) {
  const thumb = <PhotoThumb photo={photo} mode={mode} />;

  // In card mode a labeled photo tints its mat. The hex is exposed as a CSS
  // variable and the `.label-mat` class (in globals.css) decides how to render it
  // per theme — light uses it as-is, dark blends it toward the mat surface so the
  // pastels don't glow against the near-black background.
  const labelHex = mode === "card" ? colorLabelHex(photo.colorLabel) : undefined;
  const labelStyle = labelHex
    ? ({ "--label-tint": labelHex } as React.CSSProperties)
    : undefined;

  // No href when the detail view is disabled (Trash): the tile is select-only.
  const href = onOpen
    ? urlForId
      ? urlForId(photo.id)
      : photoHref(photo.id, albumId, sort)
    : undefined;

  return (
    <a
      href={href}
      onClick={(e) => {
        // ⌘/Ctrl/middle click on a real link opens the detail in a new tab;
        // every other click selects (plain = toggle, shift = range).
        if (href && (e.metaKey || e.ctrlKey || e.button !== 0)) return;
        e.preventDefault();
        onTileClick(index, e);
      }}
      onDoubleClick={(e) => {
        if (!onOpen) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onOpen(index);
      }}
      className={cn(
        cellVariants({ mode, selected: isSelected }),
        "select-none",
        labelHex && "label-mat",
      )}
      style={labelStyle}
    >
      {thumb}
    </a>
  );
}
```

- [ ] **Step 2: Drop `selectMode` from `PhotoGrid`**

In `apps/web/src/components/photo-grid/photo-grid.tsx`:

Remove `selectMode = false,` from the destructured props (the line between `columns: columnsProp = DEFAULT_COLUMNS,` and `selectedIds,`).

Remove `selectMode?: boolean;` from the props type (the line between `columns?: number;` and `selectedIds?: Set<string>;`).

Remove this effect entirely:

```ts
  useEffect(() => {
    if (!selectMode) anchorRef.current = null;
  }, [selectMode]);
```

In the `<PhotoGridTile ... />` render, remove this line:

```tsx
                    selectMode={selectMode}
```

(Leave `onOpen`, `urlForId`, `isSelected`, `onTileClick`, `index`, `mode`, `photo`, `key` in place.)

- [ ] **Step 3: Library toolbar → `count > 0`**

In `apps/web/src/app/(app)/photos/library-view.tsx`:

In the lucide import, remove `SquareCheckBig`:

```ts
import { Download, FolderPlus, Loader2, SquareCheckBig, Trash2 } from "lucide-react";
```
→
```ts
import { Download, FolderPlus, Loader2, Trash2 } from "lucide-react";
```

In `handleDelete`, change `sel.cancel();` → `sel.clear();`.

Change the toolbar conditional `{sel.selectMode ? (` → `{sel.count > 0 ? (`.

In `<SelectionToolbar ...>`, change `onCancel={sel.cancel}` → `onCancel={sel.clear}`.

Remove the Select button from the `HeaderBar` else branch:

```tsx
              <Button
                variant="outline"
                size="icon-sm"
                onClick={sel.enter}
                aria-label="Select"
                title="Select"
              >
                <SquareCheckBig aria-hidden />
              </Button>
```

In `<PhotoGrid ...>`, remove `selectMode={sel.selectMode}`.

- [ ] **Step 4: Album toolbar → `count > 0`**

In `apps/web/src/app/(app)/albums/[id]/album-view.tsx`:

In the lucide import, remove `SquareCheckBig`:

```ts
import { Download, FolderMinus, FolderPlus, Images, Loader2, SquareCheckBig, Trash2 } from "lucide-react";
```
→
```ts
import { Download, FolderMinus, FolderPlus, Images, Loader2, Trash2 } from "lucide-react";
```

In `handleCancel`, `handleRemove`, and `handleDelete`, change each `sel.cancel();` → `sel.clear();` (three occurrences). (Leave `handleCancel`'s `setRemoveError(null);` in place.)

Change the toolbar conditional `{sel.selectMode ? (` → `{sel.count > 0 ? (`.

Remove the Select button from the `HeaderBar` else branch:

```tsx
              <Button
                variant="outline"
                size="icon-sm"
                onClick={sel.enter}
                aria-label="Select"
                title="Select"
              >
                <SquareCheckBig aria-hidden />
              </Button>
```

In `<PhotoGrid ...>`, remove `selectMode={sel.selectMode}`.

- [ ] **Step 5: Search toolbar → `count > 0`**

In `apps/web/src/app/(app)/search/search-view.tsx`:

In the lucide import, remove `SquareCheckBig` (keep `X`):

```ts
import { Download, FolderPlus, Loader2, SquareCheckBig, Trash2, X } from "lucide-react";
```
→
```ts
import { Download, FolderPlus, Loader2, Trash2, X } from "lucide-react";
```

Change the selection-reset destructure `const { cancel: resetSelection } = sel;` → `const { clear: resetSelection } = sel;` (the `useEffect` dep stays `[serialized, resetSelection]`).

In `handleDelete`, change `sel.cancel();` → `sel.clear();`.

Replace the count/label conditional:

```tsx
                {sel.selectMode ? (
                  <span className="text-sm font-medium">
                    {sel.count > 0 ? `${sel.count} selected` : "Select photos"}
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    {searchCount !== null
                      ? `${searchCount.toLocaleString()} ${searchCount === 1 ? "photo" : "photos"}`
                      : null}
                  </span>
                )}
```

with:

```tsx
                {sel.count > 0 ? (
                  <span className="text-sm font-medium">{sel.count} selected</span>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    {searchCount !== null
                      ? `${searchCount.toLocaleString()} ${searchCount === 1 ? "photo" : "photos"}`
                      : null}
                  </span>
                )}
```

Change the actions conditional `{sel.selectMode ? (` → `{sel.count > 0 ? (`.

In the actions selection branch, change the Cancel button's `onClick={sel.cancel}` → `onClick={sel.clear}`.

Remove the Select button from the actions else branch:

```tsx
                      <Button
                        variant="outline"
                        size="icon-sm"
                        onClick={sel.enter}
                        aria-label="Select"
                        title="Select"
                      >
                        <SquareCheckBig aria-hidden />
                      </Button>
```

In `<PhotoGrid ...>`, remove `selectMode={sel.selectMode}`.

- [ ] **Step 6: Drop the dead `selectMode` prop in Trash**

In `apps/web/src/app/(app)/trash/trash-view.tsx`, in `<PhotoGrid ...>`, remove the bare `selectMode` prop line:

```tsx
          selectMode
```

(Leave `apiRef`, `selectedIds`, `onSelectionChange`, `empty` in place. Trash's `PhotoCollectionProvider` already passes `enableLightbox={false}`, so `onOpen` is undefined and tiles are select-only.)

- [ ] **Step 7: Typecheck, lint, test**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: exits 0.
Run: `pnpm --filter @lumio/web lint`
Expected: exits 0.
Run: `pnpm --filter @lumio/web test`
Expected: all files pass.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/photo-grid/photo-grid-tile.tsx \
  apps/web/src/components/photo-grid/photo-grid.tsx \
  "apps/web/src/app/(app)/photos/library-view.tsx" \
  "apps/web/src/app/(app)/albums/[id]/album-view.tsx" \
  "apps/web/src/app/(app)/search/search-view.tsx" \
  "apps/web/src/app/(app)/trash/trash-view.tsx"
git commit -m "feat(grid): click selects, double-click opens; drop photo-grid select mode"
```

---

### Task 4: Albums grid — click selects, double-click opens the album

**Files:**
- Rewrite: `apps/web/src/app/(app)/albums/album-card.tsx`
- Modify: `apps/web/src/app/(app)/albums/albums-view.tsx`

- [ ] **Step 1: Rewrite `album-card.tsx`**

Replace the entire contents of `apps/web/src/app/(app)/albums/album-card.tsx` with:

```tsx
"use client";

import { Images } from "lucide-react";
import type { AlbumSummaryDTO } from "@lumio/shared";
import { cn } from "@/lib/utils";

/**
 * One album in the listing grid. Selection is always available: a plain left
 * click toggles the album in the shared selection set (blue ring, no
 * navigation); a double click opens it. ⌘/Ctrl/middle click falls through to the
 * native link, so the album opens in a new tab.
 */
export function AlbumCard({
  album,
  isSelected,
  onToggle,
  onOpen,
}: {
  album: AlbumSummaryDTO;
  isSelected: boolean;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const cover = (
    <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-sm bg-muted">
      {album.coverPhotoId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/thumbnails/${album.coverPhotoId}`}
          alt={album.name}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
        />
      ) : (
        <Images className="size-8 text-muted-foreground" />
      )}
    </div>
  );

  const meta = (
    <div className="mt-2.5">
      <p className="truncate text-sm font-semibold">{album.name}</p>
      <p className="text-xs text-muted-foreground">
        {album.photoCount} {album.photoCount === 1 ? "photo" : "photos"}
      </p>
    </div>
  );

  return (
    <a
      href={`/albums/${album.id}`}
      onClick={(e) => {
        // ⌘/Ctrl/middle click opens the album in a new tab; a plain click toggles.
        if (e.metaKey || e.ctrlKey || e.button !== 0) return;
        e.preventDefault();
        onToggle(album.id);
      }}
      onDoubleClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onOpen(album.id);
      }}
      className="group block select-none"
    >
      <div
        className={cn(
          "relative rounded-sm",
          isSelected && "ring-2 ring-offset-2 ring-offset-background ring-blue-500",
        )}
      >
        {cover}
      </div>
      {meta}
    </a>
  );
}
```

- [ ] **Step 2: Update `albums-view.tsx`**

In `apps/web/src/app/(app)/albums/albums-view.tsx`:

In the lucide import, remove `SquareCheckBig`:

```ts
import { FolderOpen, Loader2, SquareCheckBig, Trash2 } from "lucide-react";
```
→
```ts
import { FolderOpen, Loader2, Trash2 } from "lucide-react";
```

Add an `open` helper next to `toggle` (router is already imported and in scope):

```tsx
  function open(id: string) {
    router.push(`/albums/${id}`);
  }
```

In `handleDelete`, change `sel.cancel();` → `sel.clear();`.

Change the toolbar conditional `{sel.selectMode ? (` → `{sel.count > 0 ? (`.

In `<SelectionToolbar ...>`, change `onCancel={sel.cancel}` → `onCancel={sel.clear}`.

Remove the Select button from the `HeaderBar` else branch:

```tsx
              <Button
                variant="outline"
                size="icon-sm"
                onClick={sel.enter}
                aria-label="Select"
                title="Select"
              >
                <SquareCheckBig aria-hidden />
              </Button>
```

In BOTH `<AlbumSection ... />` usages (the `regular` and `smart` sections), remove `selectMode={sel.selectMode}` and add `onOpen={open}`. Each should read:

```tsx
          <AlbumSection
            title="Albums"
            albums={regular}
            selected={sel.selected}
            onToggle={toggle}
            onOpen={open}
          />
```

(and likewise the `smart` one with `title="Smart Albums"` and `albums={smart}`).

In the `AlbumSection` function signature, remove `selectMode` and add `onOpen`:

```tsx
function AlbumSection({
  title,
  albums,
  selected,
  onToggle,
  onOpen,
}: {
  title: string;
  albums: AlbumSummaryDTO[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
}) {
```

In the `<AlbumCard ... />` render inside `AlbumSection`, remove `selectMode={selectMode}` and add `onOpen={onOpen}`:

```tsx
          <AlbumCard
            key={album.id}
            album={album}
            isSelected={selected.has(album.id)}
            onToggle={onToggle}
            onOpen={onOpen}
          />
```

- [ ] **Step 3: Typecheck, lint, test**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: exits 0.
Run: `pnpm --filter @lumio/web lint`
Expected: exits 0.
Run: `pnpm --filter @lumio/web test`
Expected: all files pass.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(app)/albums/album-card.tsx" \
  "apps/web/src/app/(app)/albums/albums-view.tsx"
git commit -m "feat(albums): click selects, double-click opens; drop albums select mode"
```

---

### Task 5: Upload grid — always-selectable tiles, blue ring

**Files:**
- Modify: `apps/web/src/app/(app)/upload/upload-tile.tsx`
- Modify: `apps/web/src/app/(app)/upload/upload-client.tsx`

- [ ] **Step 1: Update `upload-tile.tsx`**

In `apps/web/src/app/(app)/upload/upload-tile.tsx`:

In the lucide import, remove `CheckCircle2, Circle` (keep `Loader2, RotateCw`):

```ts
import { CheckCircle2, Circle, Loader2, RotateCw } from "lucide-react";
```
→
```ts
import { Loader2, RotateCw } from "lucide-react";
```

Remove `selectMode,` from the destructured props and remove `selectMode: boolean;` from the props type.

Change the interactivity line:

```ts
  const interactive = selectMode && selectable;
```
→
```ts
  const interactive = selectable;
```

In the thumb outer `<div>` className, change the selected ring:

```ts
        selected && "ring-2 ring-inset ring-primary",
```
→
```ts
        selected && "ring-2 ring-offset-2 ring-offset-background ring-blue-500",
```

In the inner `<div>` wrapping the image/badge, drop the shrink-on-select (remove the `transition-transform` + scale):

```tsx
      <div
        className={cn(
          "h-full w-full overflow-hidden rounded-xs transition-transform",
          selected && "scale-[0.92]",
        )}
      >
```
→
```tsx
      <div className="h-full w-full overflow-hidden rounded-xs">
```

Remove the checkmark overlay block entirely:

```tsx
      {selectMode && selectable ? (
        <span className="absolute left-1.5 top-1.5 rounded-full bg-background">
          {selected ? (
            <CheckCircle2 className="size-5 text-primary" aria-hidden />
          ) : (
            <Circle className="size-5 text-muted-foreground" aria-hidden />
          )}
        </span>
      ) : null}
```

(`cn` is still used elsewhere in the file — keep its import.)

- [ ] **Step 2: Update `upload-client.tsx`**

In `apps/web/src/app/(app)/upload/upload-client.tsx`:

In the lucide import, remove `SquareCheckBig`:

```ts
import { Download, FolderPlus, Loader2, SquareCheckBig, Trash2 } from "lucide-react";
```
→
```ts
import { Download, FolderPlus, Loader2, Trash2 } from "lucide-react";
```

Remove the anchor-reset effect tied to select mode (keep `anchorRef` itself and the other effects):

```ts
  useEffect(() => {
    // Drop the anchor when leaving select mode so a later shift-click doesn't
    // extend from a stale index (mirrors the photo grid).
    if (!sel.selectMode) anchorRef.current = null;
  }, [sel.selectMode]);
```

In `handleDelete`, change `sel.cancel();` → `sel.clear();`.

Change the toolbar conditional `{sel.selectMode ? (` → `{sel.count > 0 ? (`.

In `<SelectionToolbar ...>`, change `onCancel={sel.cancel}` → `onCancel={sel.clear}`.

Replace the `HeaderBar` else branch's `actions` (drop the Select button, keep the grid size menu):

```tsx
          actions={
            hasRows ? (
              <>
                <GridSizeMenu columns={columns} onColumnsChange={setColumns} />
                <Button
                  variant="outline"
                  size="icon-sm"
                  disabled={ids.length === 0}
                  onClick={sel.enter}
                  aria-label="Select"
                  title="Select"
                >
                  <SquareCheckBig aria-hidden />
                </Button>
              </>
            ) : null
          }
```
→
```tsx
          actions={
            hasRows ? <GridSizeMenu columns={columns} onColumnsChange={setColumns} /> : null
          }
```

In the `<UploadTile ... />` render, remove `selectMode={sel.selectMode}`.

Note: `ids` (from `selectableIds(rows)`) is still referenced elsewhere? After removing the Select button it is no longer used. Remove its declaration `const ids = selectableIds(rows);` AND the now-unused `selectableIds` import:

```ts
import { selectableIds, summarizeRows, type Row, type RowStatus } from "@/lib/upload-rows";
```
→
```ts
import { summarizeRows, type Row, type RowStatus } from "@/lib/upload-rows";
```

(Verify with the lint step — `no-unused-vars` will flag `ids`/`selectableIds` if either is missed.)

- [ ] **Step 3: Typecheck, lint, test**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: exits 0.
Run: `pnpm --filter @lumio/web lint`
Expected: exits 0.
Run: `pnpm --filter @lumio/web test`
Expected: all files pass.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(app)/upload/upload-tile.tsx" \
  "apps/web/src/app/(app)/upload/upload-client.tsx"
git commit -m "feat(upload): always-selectable tiles with blue ring; drop upload select mode"
```

---

### Task 6: Remove the dead select-mode API from the hook

All consumers now use `count`/`clear` only. Remove `selectMode`/`enter`/`cancel` and simplify Escape to "clear selection".

**Files:**
- Modify: `apps/web/src/lib/use-grid-selection.ts`

- [ ] **Step 1: Confirm there are no remaining consumers**

Run: `git grep -nE "selectMode|sel\.enter|sel\.cancel|\.enter\(\)|\.cancel\(\)" -- "apps/web/src/**/*.ts" "apps/web/src/**/*.tsx"`
Expected: no matches (empty output). If anything matches, migrate it the same way (conditional → `count > 0`, `cancel`/`enter` → `clear`/remove) before continuing.

- [ ] **Step 2: Rewrite the hook**

Replace the entire contents of `apps/web/src/lib/use-grid-selection.ts` with:

```ts
import { useCallback, useEffect, useState } from "react";

/** Owns the selected photo-id set. Selection is always available (no mode). */
export function useGridSelection() {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const clear = useCallback(() => setSelected(new Set()), []);

  // Escape clears the selection. Let text fields and open overlays (dialogs, the
  // color-label menu, the photo viewer) keep Escape for themselves.
  const hasSelection = selected.size > 0;
  useEffect(() => {
    if (!hasSelection) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target?.isContentEditable || target?.closest("input, textarea, select")) {
        return;
      }
      if (
        document.querySelector(
          '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]',
        )
      ) {
        return;
      }
      e.preventDefault();
      clear();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [hasSelection, clear]);

  return {
    selected,
    setSelected,
    clear,
    count: selected.size,
  };
}
```

- [ ] **Step 3: Typecheck, lint, test**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: exits 0.
Run: `pnpm --filter @lumio/web lint`
Expected: exits 0.
Run: `pnpm --filter @lumio/web test`
Expected: all files pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/use-grid-selection.ts
git commit -m "refactor(grid): drop unused select-mode API from useGridSelection"
```

---

### Task 7: Full verification + browser check

**Files:** none (verification only; commit only if ring tuning is needed).

- [ ] **Step 1: Full gate**

Run: `pnpm --filter @lumio/web exec tsc --noEmit` → exits 0.
Run: `pnpm --filter @lumio/web lint` → exits 0.
Run: `pnpm --filter @lumio/web test` → all files pass.

- [ ] **Step 2: Browser verification**

Start the app (`pnpm dev`) and, in each of Library, Album, Search, Albums, Upload, Trash, confirm:
- Single left click toggles a **blue outer ring** (no checkmark, no shrink).
- Double click opens the lightbox (photo grids) / the album (Albums grid); Upload and Trash have no detail and a double click does nothing.
- Shift-click selects a range; ⌘-click opens the photo/album in a new tab.
- Escape clears the selection; the action toolbar appears when `count > 0` and reverts to the browse toolbar (view/size/sort menus, New album, etc.) when the selection empties.
- The blue ring reads as an outer ring without overlapping neighbors at the smallest and largest grid sizes in each view.

- [ ] **Step 3 (only if ring tuning needed):** Adjust the ring width/offset in `apps/web/src/components/photo-grid/cell-variants.ts` (and the matching classes in `album-card.tsx` / `upload-tile.tsx`), re-run Step 1, then commit:

```bash
git add -A
git commit -m "style(grid): tune selected ring offset"
```
```

---

## Self-Review

**Spec coverage:**
- Click = select, double-click = open → Tasks 3 (photos), 4 (albums). Upload/Trash have no detail (Task 5, Task 3 step 6). ✓
- Net-zero double-click reconciliation → guarded in Task 1, realized by the tile's `onClick`+`onDoubleClick` in Tasks 3/4. ✓
- Blue outer ring, no checkmark/shrink → Task 2 (cell-variants, used by photo tiles), Task 4 (album-card), Task 5 (upload-tile). ✓
- Remove select-mode toggle from all toolbars → Tasks 3/4/5 (Library, Album, Search, Albums, Upload); Trash already count-based (Task 3 step 6). ✓
- `useGridSelection` loses `selectMode`/`enter`/`cancel`, Escape clears → Task 6. ✓
- Keep `<a href>` for ⌘-click new tab / keyboard Enter → tile + album-card. ✓

**Type consistency:** `clear`/`count`/`selected`/`setSelected` are the only hook members referenced after Task 3; `onOpen` is added to `AlbumCard` and `AlbumSection` with signature `(id: string) => void`; `PhotoGridTile` drops `selectMode` and keeps `onTileClick: (index, e) => void` and optional `onOpen: (index) => void`. Consistent across tasks.

**Placeholder scan:** none — every code step shows full content or exact before/after.
