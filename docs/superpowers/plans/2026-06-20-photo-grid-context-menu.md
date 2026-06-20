# Photo Grid Context Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a right-click context menu (Download, Add to album, Color label, Delete) to photos in the Library, Search, and Album grids.

**Architecture:** Unify the four photo operations into one `usePhotoActions` hook (mirroring the existing `useConfirm` idiom: returns action functions + an `element` to render once). The three views call it for both their selection toolbars and — via a small `PhotoActionsContext` around the grid — a per-tile `PhotoContextMenu`. Targeting is selection-aware: right-clicking a selected photo acts on the whole selection, otherwise on that one photo.

**Tech Stack:** Next.js (App Router, `--webpack`), React (React Compiler), TypeScript, shadcn/ui (`radix-maia` style) on Radix, Tailwind, lucide-react, vitest.

**Spec:** `docs/superpowers/specs/2026-06-20-photo-grid-context-menu-design.md`

---

## Conventions for every task

- Typecheck: `pnpm --filter @lumio/web exec tsc --noEmit` (runs clean today; expect no output, exit 0).
- Lint: `pnpm --filter @lumio/web lint`.
- Unit tests: `pnpm --filter @lumio/web test <filter>` (runs `vitest run <filter>`).
- React Compiler rules in this repo: `"use client"` must be line 1; mutate only local copies; prefer functional `setState` updaters. Keep these in mind for every new client file.
- Commit after each task with the message shown in its final step.

---

## Task 1: Add the shadcn `context-menu` primitive

**Files:**
- Create: `apps/web/src/components/ui/context-menu.tsx` (generated — do not hand-author)

- [ ] **Step 1: Generate the component**

Run from the `apps/web` directory:

```bash
pnpm dlx shadcn@latest add @shadcn/context-menu
```

This writes `apps/web/src/components/ui/context-menu.tsx` (style `radix-maia`) and adds `@radix-ui/react-context-menu` to `apps/web/package.json`.

- [ ] **Step 2: Verify the file and the destructive-item prop exist**

Run:

```bash
ls apps/web/src/components/ui/context-menu.tsx
rg "data-\[variant=destructive\]" apps/web/src/components/ui/context-menu.tsx
```

Expected: the file exists, and the grep matches (proving `ContextMenuItem` accepts `variant="destructive"`, same as `dropdown-menu.tsx`). If the grep finds nothing, the generated item lacks the variant prop — in that case Task 4 must style the Delete item with `className="text-destructive focus:text-destructive focus:bg-destructive/10"` instead of `variant="destructive"`.

- [ ] **Step 3: Verify exports used later are present**

Run:

```bash
rg "export (function|const) (ContextMenu|ContextMenuTrigger|ContextMenuContent|ContextMenuItem|ContextMenuLabel|ContextMenuSeparator|ContextMenuSub|ContextMenuSubTrigger|ContextMenuSubContent)\b" apps/web/src/components/ui/context-menu.tsx
```

Expected: all nine names are exported. (They are standard shadcn context-menu exports.)

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: clean (exit 0).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui/context-menu.tsx apps/web/package.json pnpm-lock.yaml
git commit -m "feat(ui): add shadcn context-menu primitive"
```

---

## Task 2: `resolveTargets` selection-aware helper (TDD)

**Files:**
- Create: `apps/web/src/lib/resolve-targets.ts`
- Test: `apps/web/src/lib/resolve-targets.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/resolve-targets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveTargets } from "./resolve-targets";

describe("resolveTargets", () => {
  it("returns the whole selection when the photo is in it", () => {
    const selected = new Set(["a", "b", "c"]);
    expect(new Set(resolveTargets(selected, "b"))).toEqual(selected);
  });

  it("returns just the photo when it is not in the selection", () => {
    expect(resolveTargets(new Set(["a", "b"]), "z")).toEqual(["z"]);
  });

  it("returns just the photo when the selection is empty", () => {
    expect(resolveTargets(new Set(), "z")).toEqual(["z"]);
  });

  it("returns just the photo when the selection is undefined", () => {
    expect(resolveTargets(undefined, "z")).toEqual(["z"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/web test resolve-targets`
Expected: FAIL — cannot resolve `./resolve-targets`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/lib/resolve-targets.ts`:

```ts
/**
 * The id set a per-photo action should operate on. Selection-aware: if the
 * photo is part of the current multi-selection, act on the whole selection;
 * otherwise act on just that one photo. Never mutates the selection.
 */
export function resolveTargets(
  selectedIds: Set<string> | undefined,
  photoId: string,
): string[] {
  return selectedIds?.has(photoId) ? [...selectedIds] : [photoId];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/web test resolve-targets`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/resolve-targets.ts apps/web/src/lib/resolve-targets.test.ts
git commit -m "feat(grid): add selection-aware resolveTargets helper"
```

---

## Task 3: `usePhotoActions` hook + `PhotoActionsContext`

**Files:**
- Create: `apps/web/src/components/photo-actions/use-photo-actions.tsx`
- Create: `apps/web/src/components/photo-actions/photo-actions-context.tsx`

- [ ] **Step 1: Write the hook**

Create `apps/web/src/components/photo-actions/use-photo-actions.tsx`:

```tsx
"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { ColorLabel } from "@lumio/shared";
import { downloadSelection } from "@/lib/download-client";
import { useConfirm } from "@/components/confirm-dialog";
import { AddToAlbumDialog } from "@/components/photo-actions/add-to-album-dialog";
import type { PhotoGridHandle } from "@/components/photo-grid/photo-grid";

/** Per-call hook into a successful action (e.g. clear/cancel the selection). */
export type ActionOpts = { onSuccess?: () => void };

export interface PhotoActions {
  download: (ids: string[], opts?: ActionOpts) => Promise<void>;
  applyLabel: (ids: string[], label: ColorLabel | null, opts?: ActionOpts) => Promise<void>;
  trash: (ids: string[], opts?: ActionOpts) => Promise<void>;
  addToAlbum: (ids: string[], opts?: ActionOpts) => void;
  pending: { download: boolean; label: boolean; trash: boolean };
  /** Dialogs (add-to-album + trash confirm). Render once per view. */
  element: React.ReactNode;
}

const DEFAULT_TRASH_DESCRIPTION = "They'll be moved to Trash. You can restore them later.";

/**
 * The four photo operations (download, color label, add-to-album, trash) over an
 * explicit id array. Owns the network call + optimistic grid update + error
 * toast + in-flight guard — the part that is identical across the photo views.
 * Each caller supplies its own aftermath via `opts.onSuccess` (e.g. the toolbar
 * clears the selection; the context menu leaves it alone). Mirrors `useConfirm`:
 * returns the action functions plus an `element` to render.
 */
export function usePhotoActions({
  gridRef,
  excludeAlbumId,
  trashDescription = DEFAULT_TRASH_DESCRIPTION,
  onTrashed,
}: {
  gridRef: React.RefObject<PhotoGridHandle | null>;
  /** Hide this album from the add-to-album list (the album being viewed). */
  excludeAlbumId?: string;
  /** Confirm-dialog body for trash (album view phrases it differently). */
  trashDescription?: string;
  /** Fires after any successful trash, for view-level side effects (e.g. a
   *  search result count or an album `router.refresh()`). */
  onTrashed?: (ids: string[]) => void;
}): PhotoActions {
  const { confirm, confirmDialog } = useConfirm();
  const [downloading, setDownloading] = useState(false);
  const [labelPending, setLabelPending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Open the add-to-album dialog for a captured id set; `onSuccess` runs on add.
  const [albumTarget, setAlbumTarget] = useState<{ ids: string[]; onSuccess?: () => void } | null>(null);

  const download = useCallback(
    async (ids: string[], opts?: ActionOpts) => {
      if (ids.length === 0 || downloading) return;
      setDownloading(true);
      try {
        await downloadSelection(ids);
        opts?.onSuccess?.();
      } catch {
        toast.error("Failed to download photos.");
      } finally {
        setDownloading(false);
      }
    },
    [downloading],
  );

  const applyLabel = useCallback(
    async (ids: string[], label: ColorLabel | null, opts?: ActionOpts) => {
      if (ids.length === 0 || labelPending) return;
      setLabelPending(true);
      try {
        const res = await fetch("/api/photos/color-label", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ photoIds: ids, label }),
        });
        if (!res.ok) throw new Error("label failed");
        gridRef.current?.patchPhotos(new Set(ids), { colorLabel: label });
        opts?.onSuccess?.();
      } catch {
        toast.error("Failed to apply label.");
      } finally {
        setLabelPending(false);
      }
    },
    [labelPending, gridRef],
  );

  const trash = useCallback(
    async (ids: string[], opts?: ActionOpts) => {
      if (ids.length === 0 || deleting) return;
      const label = `${ids.length} ${ids.length === 1 ? "photo" : "photos"}`;
      const ok = await confirm({
        title: `Move ${label} to Trash?`,
        description: trashDescription,
        confirmLabel: "Move to Trash",
        destructive: true,
      });
      if (!ok) return;
      setDeleting(true);
      try {
        const res = await fetch("/api/photos/trash", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        if (!res.ok) throw new Error("trash failed");
        gridRef.current?.removePhotos(new Set(ids));
        onTrashed?.(ids);
        opts?.onSuccess?.();
      } catch {
        toast.error("Failed to move photos to Trash.");
      } finally {
        setDeleting(false);
      }
    },
    [deleting, confirm, trashDescription, gridRef, onTrashed],
  );

  const addToAlbum = useCallback((ids: string[], opts?: ActionOpts) => {
    if (ids.length === 0) return;
    setAlbumTarget({ ids, onSuccess: opts?.onSuccess });
  }, []);

  const element = (
    <>
      {confirmDialog}
      <AddToAlbumDialog
        open={albumTarget !== null}
        onOpenChange={(open) => {
          if (!open) setAlbumTarget(null);
        }}
        photoIds={albumTarget?.ids ?? []}
        excludeAlbumId={excludeAlbumId}
        onAdded={() => {
          albumTarget?.onSuccess?.();
          setAlbumTarget(null);
        }}
      />
    </>
  );

  return {
    download,
    applyLabel,
    trash,
    addToAlbum,
    pending: { download: downloading, label: labelPending, trash: deleting },
    element,
  };
}
```

- [ ] **Step 2: Write the context**

Create `apps/web/src/components/photo-actions/photo-actions-context.tsx`:

```tsx
"use client";

import { createContext, useContext } from "react";
import type { PhotoActions } from "./use-photo-actions";

/** Carries the view's `usePhotoActions` value down to grid tiles. Null when no
 *  provider is present (e.g. the Trash grid), which the menu treats as "no menu". */
const PhotoActionsContext = createContext<PhotoActions | null>(null);

export const PhotoActionsProvider = PhotoActionsContext.Provider;

export function usePhotoActionsContext(): PhotoActions | null {
  return useContext(PhotoActionsContext);
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: clean (exit 0).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/photo-actions/use-photo-actions.tsx apps/web/src/components/photo-actions/photo-actions-context.tsx
git commit -m "feat(photo-actions): shared usePhotoActions hook + context"
```

---

## Task 4: `PhotoContextMenu` component

**Files:**
- Create: `apps/web/src/components/photo-grid/photo-context-menu.tsx`

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/photo-grid/photo-context-menu.tsx`:

```tsx
"use client";

import { Download, FolderPlus, Palette, Trash2 } from "lucide-react";
import { COLOR_LABELS } from "@lumio/shared";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { usePhotoActionsContext } from "@/components/photo-actions/photo-actions-context";

/**
 * Wraps a grid tile as a right-click context-menu trigger: Download, Add to
 * album, Color label (submenu), Delete. `targetIds` is already resolved
 * selection-aware by the caller. Renders the tile unwrapped when no actions
 * provider is present (e.g. the Trash grid), so the menu is a clean no-op there.
 */
export function PhotoContextMenu({
  targetIds,
  onTrashed,
  children,
}: {
  targetIds: string[];
  /** Called after a successful menu-driven trash (drops ids from selection). */
  onTrashed?: () => void;
  children: React.ReactNode;
}) {
  const actions = usePhotoActionsContext();
  if (!actions) return <>{children}</>;

  const count = targetIds.length;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        {count > 1 && (
          <>
            <ContextMenuLabel>{count} photos</ContextMenuLabel>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem onSelect={() => void actions.download(targetIds)}>
          <Download aria-hidden />
          Download
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => actions.addToAlbum(targetIds)}>
          <FolderPlus aria-hidden />
          Add to album
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Palette aria-hidden />
            Color label
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-40">
            {COLOR_LABELS.map((c) => (
              <ContextMenuItem
                key={c.slug}
                onSelect={() => void actions.applyLabel(targetIds, c.slug)}
              >
                <span
                  className="size-4 rounded-full ring-1 ring-foreground/10"
                  style={{ backgroundColor: c.hex }}
                  aria-hidden
                />
                {c.name}
              </ContextMenuItem>
            ))}
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => void actions.applyLabel(targetIds, null)}>
              None
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onSelect={() => void actions.trash(targetIds, { onSuccess: onTrashed })}
        >
          <Trash2 aria-hidden />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
```

> If Task 1 Step 2 found that `ContextMenuItem` has no `variant` prop, replace `variant="destructive"` on the Delete item with `className="text-destructive focus:text-destructive focus:bg-destructive/10"`.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: clean (exit 0).

- [ ] **Step 3: Lint**

Run: `pnpm --filter @lumio/web lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/photo-grid/photo-context-menu.tsx
git commit -m "feat(grid): PhotoContextMenu with download/album/label/delete"
```

---

## Task 5: Wire the menu into the grid tile

**Files:**
- Modify: `apps/web/src/components/photo-grid/photo-grid-tile.tsx`
- Modify: `apps/web/src/components/photo-grid/photo-grid.tsx`

- [ ] **Step 1: Replace `photo-grid-tile.tsx` in full**

Overwrite `apps/web/src/components/photo-grid/photo-grid-tile.tsx` with:

```tsx
"use client";

import { CheckCircle2, Circle } from "lucide-react";
import { colorLabelHex, type PhotoDTO, type PhotoSort } from "@lumio/shared";
import { photoHref } from "@/lib/photo-href";
import type { GridViewMode } from "@/lib/use-grid-view";
import { cn } from "@/lib/utils";
import { resolveTargets } from "@/lib/resolve-targets";
import { cellVariants } from "./cell-variants";
import { PhotoContextMenu } from "./photo-context-menu";
import { PhotoThumb } from "./photo-thumb";

/**
 * One grid cell. In select mode it's a toggle button with a checkbox overlay and
 * a shrink-on-select affordance; otherwise it's a Link to the photo. Both wrap
 * the same PhotoThumb, and both are wrapped in a right-click PhotoContextMenu.
 */
export function PhotoGridTile({
  photo,
  mode,
  albumId,
  sort,
  onOpen,
  urlForId,
  selectMode,
  isSelected,
  index,
  onTileClick,
  selectedIds,
  onTrash,
}: {
  photo: PhotoDTO;
  mode: GridViewMode;
  albumId?: string;
  sort?: PhotoSort;
  onOpen?: (index: number) => void;
  urlForId?: (id: string) => string;
  selectMode: boolean;
  isSelected: boolean;
  index: number;
  onTileClick: (index: number, e: React.MouseEvent) => void;
  /** Current selection, for selection-aware context-menu targeting. */
  selectedIds?: Set<string>;
  /** Drop these ids from the selection after a menu-driven trash. */
  onTrash?: (ids: string[]) => void;
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

  const targetIds = resolveTargets(selectedIds, photo.id);

  const tile = selectMode ? (
    <button
      type="button"
      aria-pressed={isSelected}
      onClick={(e) => onTileClick(index, e)}
      className={cn(
        cellVariants({ mode, selected: isSelected }),
        "select-none",
        labelHex && "label-mat",
      )}
      style={labelStyle}
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
  ) : (
    <a
      href={urlForId ? urlForId(photo.id) : photoHref(photo.id, albumId, sort)}
      onClick={(e) => {
        if (!onOpen) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onOpen(index);
      }}
      className={cn(cellVariants({ mode }), labelHex && "label-mat")}
      style={labelStyle}
    >
      {thumb}
    </a>
  );

  return (
    <PhotoContextMenu
      targetIds={targetIds}
      onTrashed={onTrash ? () => onTrash(targetIds) : undefined}
    >
      {tile}
    </PhotoContextMenu>
  );
}
```

- [ ] **Step 2: Add the selection-drop callback in `photo-grid.tsx`**

In `apps/web/src/components/photo-grid/photo-grid.tsx`, the `useCallback` import already exists. Add `handleTilesTrashed` right after the existing `handleTileClick` function (which ends at the line `onSelectionChange(next);\n  }`). Insert:

```tsx
  // After a menu-driven trash, drop the trashed ids from the selection so the
  // toolbar count can't go stale. (Toolbar trash clears the whole selection
  // itself; this covers the per-photo menu path.)
  const handleTilesTrashed = useCallback(
    (ids: string[]) => {
      if (!onSelectionChange || !selectedIds || selectedIds.size === 0) return;
      const next = new Set(selectedIds);
      let changed = false;
      for (const id of ids) {
        if (next.delete(id)) changed = true;
      }
      if (changed) onSelectionChange(next);
    },
    [onSelectionChange, selectedIds],
  );
```

- [ ] **Step 3: Pass the new props to each tile in `photo-grid.tsx`**

Find the `<PhotoGridTile ... />` JSX and replace it with the version that adds `selectedIds` and `onTrash`:

```tsx
                return (
                  <PhotoGridTile
                    key={photo.id}
                    photo={photo}
                    mode={mode}
                    index={idx}
                    onOpen={enableLightbox ? open : undefined}
                    urlForId={urlForId}
                    selectMode={selectMode}
                    isSelected={selectedIds?.has(photo.id) ?? false}
                    onTileClick={handleTileClick}
                    selectedIds={selectedIds}
                    onTrash={handleTilesTrashed}
                  />
                );
```

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm --filter @lumio/web exec tsc --noEmit && pnpm --filter @lumio/web lint`
Expected: clean. (Menus are inert until a view adds the provider in Tasks 6–8 — that is intended; the Trash grid stays menu-less permanently.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/photo-grid/photo-grid-tile.tsx apps/web/src/components/photo-grid/photo-grid.tsx
git commit -m "feat(grid): wrap grid tiles in PhotoContextMenu"
```

---

## Task 6: Wire the Library view to `usePhotoActions`

**Files:**
- Modify: `apps/web/src/app/(app)/photos/library-view.tsx`

- [ ] **Step 1: Replace the import block**

Replace lines 1–24 (the whole top import block, `"use client";` through the `useConfirm` import) with:

```tsx
"use client";

import { useRef } from "react";
import { Download, FolderPlus, Loader2, SquareCheckBig, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGridSelection } from "@/lib/use-grid-selection";
import { useGridView } from "@/lib/use-grid-view";
import { useGridColumns } from "@/lib/use-grid-columns";
import { GridViewMenu } from "@/components/grid-view-menu";
import { GridSizeMenu } from "@/components/grid-size-menu";
import { useGridSort } from "@/lib/use-grid-sort";
import { GridSortMenu } from "@/components/grid-sort-menu";
import { PhotoGrid, type PhotoGridHandle } from "@/components/photo-grid/photo-grid";
import { PhotoCollectionProvider } from "@/components/photo-grid/photo-collection";
import { Lightbox } from "@/components/photo-grid/lightbox";
import { photoHref } from "@/lib/photo-href";
import { SelectionToolbar } from "./selection-toolbar";
import { ColorLabelMenu } from "@/components/photo-actions/color-label-menu";
import { HeaderBar } from "@/components/header-bar";
import { usePhotoActions } from "@/components/photo-actions/use-photo-actions";
import { PhotoActionsProvider } from "@/components/photo-actions/photo-actions-context";
```

- [ ] **Step 2: Replace the state + handler block**

Replace from `export function LibraryView() {` through the end of the `applyLabel` function (the closing `}` before `return (`) with:

```tsx
export function LibraryView() {
  const sel = useGridSelection();
  const { mode, setMode } = useGridView();
  const { columns, setColumns } = useGridColumns();
  const { sort, setSort } = useGridSort();
  const gridRef = useRef<PhotoGridHandle>(null);
  const actions = usePhotoActions({ gridRef });
```

- [ ] **Step 3: Swap the confirm-dialog slot**

Replace `      {confirmDialog}` with `      {actions.element}`.

- [ ] **Step 4: Repoint the toolbar buttons**

Replace the `actions={ ... }` block of the `SelectionToolbar` (the `ColorLabelMenu` + the three `Button`s) with:

```tsx
          actions={
            <>
              <ColorLabelMenu
                disabled={sel.count === 0 || actions.pending.label}
                onPick={(label) => void actions.applyLabel([...sel.selected], label)}
              />
              <Button
                variant="outline"
                size="icon-sm"
                disabled={sel.count === 0}
                onClick={() => actions.addToAlbum([...sel.selected])}
                aria-label="Add to album"
                title="Add to album"
              >
                <FolderPlus aria-hidden />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                disabled={sel.count === 0 || actions.pending.download}
                onClick={() => void actions.download([...sel.selected], { onSuccess: sel.clear })}
                aria-label="Download"
                title="Download"
              >
                {actions.pending.download ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
              </Button>
              <Button
                variant="destructive"
                size="icon-sm"
                disabled={sel.count === 0 || actions.pending.trash}
                onClick={() => void actions.trash([...sel.selected], { onSuccess: sel.cancel })}
                aria-label="Delete"
                title="Delete"
              >
                {actions.pending.trash ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
              </Button>
            </>
          }
```

- [ ] **Step 5: Wrap the grid in the provider and drop the old dialog**

Replace the `<PhotoCollectionProvider> … </PhotoCollectionProvider>` block **and** the trailing `<AddToAlbumDialog ... />` (everything from `<PhotoCollectionProvider` to the closing `</>`) with:

```tsx
      <PhotoCollectionProvider
        key={sort}
        endpoint="/api/photos"
        params={new URLSearchParams({ sort })}
        urlForId={(id) => photoHref(id, undefined, sort)}
        baseUrl="/photos"
      >
        <PhotoActionsProvider value={actions}>
          <PhotoGrid
            apiRef={gridRef}
            mode={mode}
            columns={columns}
            selectMode={sel.selectMode}
            selectedIds={sel.selected}
            onSelectionChange={sel.setSelected}
          />
          <Lightbox />
        </PhotoActionsProvider>
      </PhotoCollectionProvider>
    </>
  );
}
```

- [ ] **Step 6: Typecheck + lint**

Run: `pnpm --filter @lumio/web exec tsc --noEmit && pnpm --filter @lumio/web lint`
Expected: clean — no unused imports (`useState`, `toast`, `downloadSelection`, `AddToAlbumDialog`, `ColorLabel`, `useConfirm` are all gone).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/\(app\)/photos/library-view.tsx
git commit -m "feat(photos): route Library toolbar + grid menu through usePhotoActions"
```

---

## Task 7: Wire the Search view to `usePhotoActions`

**Files:**
- Modify: `apps/web/src/app/(app)/search/search-view.tsx`

- [ ] **Step 1: Replace the import block**

Replace lines 3–22 (from `import { useEffect, useRef, useState } from "react";` through `import { Lightbox } from "@/components/photo-grid/lightbox";`) with:

```tsx
import { useEffect, useRef, useState } from "react";
import { Download, FolderPlus, Loader2, SquareCheckBig, Trash2, X } from "lucide-react";
import { useGridColumns } from "@/lib/use-grid-columns";
import { useGridSort } from "@/lib/use-grid-sort";
import { useGridView } from "@/lib/use-grid-view";
import { useGridSelection } from "@/lib/use-grid-selection";
import { GridSortMenu } from "@/components/grid-sort-menu";
import { GridSizeMenu } from "@/components/grid-size-menu";
import { GridViewMenu } from "@/components/grid-view-menu";
import { Button } from "@/components/ui/button";
import { ColorLabelMenu } from "@/components/photo-actions/color-label-menu";
import { usePhotoActions } from "@/components/photo-actions/use-photo-actions";
import { PhotoActionsProvider } from "@/components/photo-actions/photo-actions-context";
import { cn } from "@/lib/utils";
import { PhotoGrid, type PhotoGridHandle } from "@/components/photo-grid/photo-grid";
import { PhotoCollectionProvider } from "@/components/photo-grid/photo-collection";
import { Lightbox } from "@/components/photo-grid/lightbox";
```

- [ ] **Step 2: Remove the per-action state**

Replace:

```tsx
  const gridRef = useRef<PhotoGridHandle>(null);
  const { confirm, confirmDialog } = useConfirm();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [labelPending, setLabelPending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState(false);
```

with:

```tsx
  const gridRef = useRef<PhotoGridHandle>(null);
```

- [ ] **Step 3: Add the hook after `searchCount`**

Replace:

```tsx
  const empty = isEmptyFilters(filters);
  const [searchCount, setSearchCount] = useSearchCount(filters, active && !empty);
```

with:

```tsx
  const empty = isEmptyFilters(filters);
  const [searchCount, setSearchCount] = useSearchCount(filters, active && !empty);
  const actions = usePhotoActions({
    gridRef,
    // Keep the result count in step with menu- or toolbar-driven trashes.
    onTrashed: (ids) =>
      setSearchCount((c) => (c === null ? c : Math.max(0, c - ids.length))),
  });
```

- [ ] **Step 4: Delete the three handler functions**

Remove the `handleDelete`, `handleDownload`, and `applyLabel` functions in full (from `  async function handleDelete() {` through the closing `}` of `applyLabel`, including the blank lines between them).

- [ ] **Step 5: Swap the confirm-dialog slot**

Replace `      {confirmDialog}` with `      {actions.element}`.

- [ ] **Step 6: Repoint the toolbar buttons**

Replace the four controls in the select-mode branch (`ColorLabelMenu` + the three `Button`s, but **not** the trailing Cancel `X` button) with:

```tsx
                      <ColorLabelMenu
                        disabled={sel.count === 0 || actions.pending.label}
                        onPick={(label) => void actions.applyLabel([...sel.selected], label)}
                      />
                      <Button
                        variant="outline"
                        size="icon-sm"
                        disabled={sel.count === 0}
                        onClick={() => actions.addToAlbum([...sel.selected])}
                        aria-label="Add to album"
                        title="Add to album"
                      >
                        <FolderPlus aria-hidden />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        disabled={sel.count === 0 || actions.pending.download}
                        onClick={() => void actions.download([...sel.selected], { onSuccess: sel.clear })}
                        aria-label="Download"
                        title="Download"
                      >
                        {actions.pending.download ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
                      </Button>
                      <Button
                        variant="destructive"
                        size="icon-sm"
                        disabled={sel.count === 0 || actions.pending.trash}
                        onClick={() => void actions.trash([...sel.selected], { onSuccess: sel.cancel })}
                        aria-label="Delete"
                        title="Delete"
                      >
                        {actions.pending.trash ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
                      </Button>
```

- [ ] **Step 7: Wrap the grid in the provider**

Replace the `<PhotoCollectionProvider> … </PhotoCollectionProvider>` block (the one with `endpoint="/api/search"`) with:

```tsx
              <PhotoCollectionProvider
                key={`${serialized}:${sort}`}
                endpoint="/api/search"
                params={paramsFor(filters, sort)}
                urlForId={(id) => `/photo/${id}?${scopeQuery(filters, sort)}`}
                baseUrl="/search"
              >
                <PhotoActionsProvider value={actions}>
                  <PhotoGrid
                    apiRef={gridRef}
                    mode={mode}
                    columns={columns}
                    selectMode={sel.selectMode}
                    selectedIds={sel.selected}
                    onSelectionChange={sel.setSelected}
                    empty={<SearchEmpty />}
                  />
                  <Lightbox />
                </PhotoActionsProvider>
              </PhotoCollectionProvider>
```

- [ ] **Step 8: Drop the trailing `AddToAlbumDialog`**

Remove the `<AddToAlbumDialog ... />` block near the end of the component (the last element before the final `</>`), leaving the `</>` in place.

- [ ] **Step 9: Typecheck + lint**

Run: `pnpm --filter @lumio/web exec tsc --noEmit && pnpm --filter @lumio/web lint`
Expected: clean — `toast`, `downloadSelection`, `useConfirm`, `AddToAlbumDialog`, and the `ColorLabel` type import are all removed.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/app/\(app\)/search/search-view.tsx
git commit -m "feat(search): route Search toolbar + grid menu through usePhotoActions"
```

---

## Task 8: Wire the Album view to `usePhotoActions`

**Files:**
- Modify: `apps/web/src/app/(app)/albums/[id]/album-view.tsx`

- [ ] **Step 1: Replace the import block**

Replace lines 3–30 (from `import { useState } from "react";` through `import { downloadSelection } from "@/lib/download-client";`) with:

```tsx
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FolderMinus, FolderPlus, Images, Loader2, SquareCheckBig, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGridSelection } from "@/lib/use-grid-selection";
import { useGridView } from "@/lib/use-grid-view";
import { useGridColumns } from "@/lib/use-grid-columns";
import { GridViewMenu } from "@/components/grid-view-menu";
import { GridSizeMenu } from "@/components/grid-size-menu";
import { useGridSort } from "@/lib/use-grid-sort";
import { GridSortMenu } from "@/components/grid-sort-menu";
import { PhotoGrid, type PhotoGridHandle } from "@/components/photo-grid/photo-grid";
import { PhotoCollectionProvider } from "@/components/photo-grid/photo-collection";
import { Lightbox } from "@/components/photo-grid/lightbox";
import { photoHref } from "@/lib/photo-href";
import { SelectionToolbar } from "@/app/(app)/photos/selection-toolbar";
import { HeaderBar } from "@/components/header-bar";
import { useConfirm } from "@/components/confirm-dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { usePhotoActions } from "@/components/photo-actions/use-photo-actions";
import { PhotoActionsProvider } from "@/components/photo-actions/photo-actions-context";
```

- [ ] **Step 2: Replace the state block (keep remove-from-album state)**

Replace:

```tsx
  const router = useRouter();
  const sel = useGridSelection();
  const { mode, setMode } = useGridView();
  const { columns, setColumns } = useGridColumns();
  const { sort, setSort } = useGridSort();
  const { confirm, confirmDialog } = useConfirm();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState(false);
```

with:

```tsx
  const router = useRouter();
  const sel = useGridSelection();
  const { mode, setMode } = useGridView();
  const { columns, setColumns } = useGridColumns();
  const { sort, setSort } = useGridSort();
  const { confirm, confirmDialog } = useConfirm();
  const [reloadKey, setReloadKey] = useState(0);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const gridRef = useRef<PhotoGridHandle>(null);
  const actions = usePhotoActions({
    gridRef,
    excludeAlbumId: albumId,
    trashDescription: "This removes them from your whole library. You can restore them from Trash.",
    // Trash is a whole-library op; refresh so server-derived album data
    // (counts, smart-album membership) stays current.
    onTrashed: () => router.refresh(),
  });
```

`useConfirm` stays — the remove-from-album action still uses it.

- [ ] **Step 3: Delete the `handleDelete` and `handleDownload` functions**

Remove both functions in full (from `  async function handleDelete() {` through the closing `}` of `handleDownload`). Leave `handleCancel` and `handleRemove` untouched.

- [ ] **Step 4: Render the hook's dialogs alongside the existing confirm**

Replace:

```tsx
      {confirmDialog}
```

with:

```tsx
      {confirmDialog}
      {actions.element}
```

- [ ] **Step 5: Repoint the toolbar buttons (keep Remove-from-album)**

Replace the Add-to-album, Download, and Delete buttons (leave the `{!isSmart && (...)}` Remove button as-is) so the block reads:

```tsx
              <Button
                variant="outline"
                size="icon-sm"
                disabled={sel.count === 0}
                onClick={() => actions.addToAlbum([...sel.selected])}
                aria-label="Add to album"
                title="Add to album"
              >
                <FolderPlus aria-hidden />
              </Button>
              {!isSmart && (
                <Button
                  variant="destructive"
                  size="icon-sm"
                  disabled={sel.count === 0 || removing}
                  onClick={() => void handleRemove()}
                  aria-label="Remove from album"
                  title="Remove from album"
                >
                  {removing ? <Loader2 className="animate-spin" aria-hidden /> : <FolderMinus aria-hidden />}
                </Button>
              )}
              <Button
                variant="outline"
                size="icon-sm"
                disabled={sel.count === 0 || actions.pending.download}
                onClick={() => void actions.download([...sel.selected], { onSuccess: sel.clear })}
                aria-label="Download"
                title="Download"
              >
                {actions.pending.download ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
              </Button>
              <Button
                variant="destructive"
                size="icon-sm"
                disabled={sel.count === 0 || actions.pending.trash}
                onClick={() => void actions.trash([...sel.selected], { onSuccess: sel.cancel })}
                aria-label="Delete"
                title="Delete"
              >
                {actions.pending.trash ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
              </Button>
```

- [ ] **Step 6: Add `apiRef`, wrap the grid, and drop the old dialog**

Replace the `<PhotoCollectionProvider> … </PhotoCollectionProvider>` block **and** the trailing `<AddToAlbumDialog ... />` (through the final `</>`) with:

```tsx
      <PhotoCollectionProvider
        key={`${reloadKey}:${sort}`}
        endpoint={`/api/albums/${albumId}/photos`}
        params={new URLSearchParams({ sort })}
        urlForId={(id) => photoHref(id, albumId, sort)}
        baseUrl={`/albums/${albumId}`}
      >
        <PhotoActionsProvider value={actions}>
          <PhotoGrid
            apiRef={gridRef}
            mode={mode}
            columns={columns}
            selectMode={sel.selectMode}
            selectedIds={sel.selected}
            onSelectionChange={sel.setSelected}
            empty={
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Images />
                  </EmptyMedia>
                  <EmptyTitle>This album is empty</EmptyTitle>
                  <EmptyDescription>
                    Photos you add to this album will appear here.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            }
          />
          <Lightbox />
        </PhotoActionsProvider>
      </PhotoCollectionProvider>
    </>
  );
}
```

> Note: trash no longer bumps `reloadKey` — the hook's optimistic `removePhotos` drops the tiles, avoiding a full remount/scroll-reset. `reloadKey` is still bumped by `handleRemove` (remove-from-album), which is unchanged.

- [ ] **Step 7: Typecheck + lint**

Run: `pnpm --filter @lumio/web exec tsc --noEmit && pnpm --filter @lumio/web lint`
Expected: clean — `toast`, `downloadSelection`, and `AddToAlbumDialog` imports are gone; `useConfirm` remains (used by remove-from-album).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/app/\(app\)/albums/\[id\]/album-view.tsx
git commit -m "feat(album): route Album toolbar + grid menu through usePhotoActions"
```

---

## Task 9: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Unit tests, typecheck, lint**

Run:

```bash
pnpm --filter @lumio/web test
pnpm --filter @lumio/web exec tsc --noEmit
pnpm --filter @lumio/web lint
```

Expected: tests pass (incl. `resolve-targets`), no type errors, no lint errors.

- [ ] **Step 2: Browser verification**

Start the app (`pnpm dev`, needs the DB on 5433 up). For **each** of `/photos`, `/search` (run a query), and an album page, in **both** non-select and select mode:

- Right-click a photo → menu opens with Download, Add to album, Color label (▸ submenu of swatches + None), and a red Delete.
- **Download** → single photo downloads the original; selecting several then right-clicking a selected one downloads a zip; menu header shows "N photos".
- **Add to album** → dialog opens; adding works; in the album view the current album is absent from the list.
- **Color label** → pick a swatch → the tile repaints immediately (card mode tints the mat); "None" clears it.
- **Delete** → confirm dialog appears; confirming removes the tile(s); Search's "N photos" count drops; the photo lands in Trash.
- **Targeting:** select 3 photos, right-click one of the 3 → action hits all 3; right-click a 4th unselected photo → action hits only that one, selection unchanged.
- **Toolbar regression:** the selection toolbar's Color label still keeps the selection after applying (per commit `cc3a95d`); Download clears the selection; Delete exits select mode.
- Confirm `/trash` still has **no** context menu and its toolbar (Restore / Delete permanently / Empty trash) is unchanged.

- [ ] **Step 3: Final commit (if any verification fixups were made)**

```bash
git add -A
git commit -m "test(grid): verify photo context menu across views"
```

---

## Self-Review

**Spec coverage:**
- Scope (Library/Search/Album, not Trash) → Tasks 6–8 add the provider; Trash untouched; `PhotoContextMenu` no-ops without a provider (Task 4). ✓
- shadcn `context-menu` via registry → Task 1. ✓
- `usePhotoActions` (download/applyLabel/trash/addToAlbum + pending + element) → Task 3. ✓
- `PhotoActionsContext` → Task 3. ✓
- `PhotoContextMenu` (4 actions, color submenu, N-photos header, graceful absence) → Task 4. ✓
- Selection-aware `resolveTargets` + tile integration + post-trash selection cleanup → Tasks 2 & 5. ✓
- View wiring preserving each aftermath (Library clear/cancel; Search count; Album refresh; keep-selection-after-label) → Tasks 6–8 + Step 2 verification. ✓
- Delete confirm → in `usePhotoActions.trash` (Task 3). ✓
- Tests → Task 2 (unit) + Task 9 (browser). ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; the single conditional (destructive variant) is gated on a concrete grep result from Task 1. ✓

**Type consistency:** `PhotoActions`, `ActionOpts`, `usePhotoActions`, `PhotoActionsProvider`, `usePhotoActionsContext`, `resolveTargets`, and the `PhotoGridTile` props (`selectedIds`, `onTrash`) are named identically across all tasks. `patchPhotos`/`removePhotos` take `Set<string>` (matching `PhotoGridHandle`); the hook wraps id arrays with `new Set(ids)`. ✓
