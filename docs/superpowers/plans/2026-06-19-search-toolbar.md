# Search Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the search results view the same toolbar and bulk actions the Library page has (grid view/size/sort + Select → color label, add to album, download, delete).

**Architecture:** The search page keeps its sticky search box at the top, so the toolbar can't reuse the sticky `HeaderBar`/`SelectionToolbar` like Library does. Instead it's an inline two-state row in the results area (where the lone sort menu lives today). All controls, hooks, and action handlers are reused from Library — this is composition plus one small refactor (moving two shared components into `components/`).

**Tech Stack:** Next.js (App Router, `--webpack`), React, TypeScript, Tailwind, shadcn/ui, vitest. Monorepo via pnpm (no turbo).

> **Testing convention (read first):** This repo unit-tests *pure logic and hooks* under `src/lib/*.test.ts` with vitest — there are **no React component render tests** (no testing-library/jsdom installed). This feature adds no new extractable pure logic: it composes already-tested components (`PhotoGrid`, `GridSizeMenu`, …) and hooks (`useGridSelection`, `useGridView`, both already covered by `grid-selection.test.ts` / `use-grid-view.test.ts`), and ports handlers verbatim from `library-view.tsx`. So the automated gates here are **the existing suite staying green + lint + a production build (typecheck)**, and behavior is confirmed by **browser verification** (Task 3) — matching how every prior UI feature in this repo was verified. Do not invent component render tests; that would diverge from the codebase.

**Verification commands (run from repo root):**
- Tests: `pnpm --filter @lumio/web test`
- Lint: `pnpm --filter @lumio/web lint`
- Typecheck/build: `pnpm --filter @lumio/web build`

---

## File Structure

**Refactor (Task 1) — move two shared components out of the `photos` route folder:**
- `apps/web/src/app/(app)/photos/color-label-menu.tsx` → `apps/web/src/components/photo-actions/color-label-menu.tsx`
- `apps/web/src/app/(app)/photos/add-to-album-dialog.tsx` → `apps/web/src/components/photo-actions/add-to-album-dialog.tsx`
- Import sites updated: `apps/web/src/app/(app)/photos/library-view.tsx` (2), `apps/web/src/app/(app)/albums/[id]/album-view.tsx` (1).

**Feature (Task 2) — the toolbar itself:**
- `apps/web/src/app/(app)/search/search-view.tsx` — rewritten to add the two-state toolbar row, selection wiring into `PhotoGrid`, and bulk-action handlers ported from `library-view.tsx`. This is the only file that changes for the feature.

**Verification (Task 3):**
- No file changes — full suite + lint + build + manual browser pass.

---

## Task 1: Move shared action components into `components/photo-actions/`

Pure refactor, no behavior change. Both files import only via `@/`-absolute paths, so they need **no internal edits** — only the move plus updating the three external import sites.

**Files:**
- Move: `apps/web/src/app/(app)/photos/color-label-menu.tsx` → `apps/web/src/components/photo-actions/color-label-menu.tsx`
- Move: `apps/web/src/app/(app)/photos/add-to-album-dialog.tsx` → `apps/web/src/components/photo-actions/add-to-album-dialog.tsx`
- Modify: `apps/web/src/app/(app)/photos/library-view.tsx:17-18`
- Modify: `apps/web/src/app/(app)/albums/[id]/album-view.tsx:17`

- [ ] **Step 1: Move both files with git (preserves history)**

Run from repo root:

```bash
mkdir -p "apps/web/src/components/photo-actions"
git mv "apps/web/src/app/(app)/photos/color-label-menu.tsx" "apps/web/src/components/photo-actions/color-label-menu.tsx"
git mv "apps/web/src/app/(app)/photos/add-to-album-dialog.tsx" "apps/web/src/components/photo-actions/add-to-album-dialog.tsx"
```

- [ ] **Step 2: Update imports in `library-view.tsx`**

Replace lines 17-18:

```tsx
import { AddToAlbumDialog } from "./add-to-album-dialog";
import { ColorLabelMenu } from "./color-label-menu";
```

with:

```tsx
import { AddToAlbumDialog } from "@/components/photo-actions/add-to-album-dialog";
import { ColorLabelMenu } from "@/components/photo-actions/color-label-menu";
```

- [ ] **Step 3: Update import in `album-view.tsx`**

Replace line 17:

```tsx
import { AddToAlbumDialog } from "@/app/(app)/photos/add-to-album-dialog";
```

with:

```tsx
import { AddToAlbumDialog } from "@/components/photo-actions/add-to-album-dialog";
```

- [ ] **Step 4: Confirm no stale import paths remain**

Run from repo root:

```bash
grep -rn "photos/color-label-menu\|photos/add-to-album-dialog\|\"\./color-label-menu\"\|\"\./add-to-album-dialog\"" apps/web/src
```

Expected: **no output** (every reference now points at `@/components/photo-actions/...`).

- [ ] **Step 5: Run lint + the existing test suite**

Run from repo root:

```bash
pnpm --filter @lumio/web lint
pnpm --filter @lumio/web test
```

Expected: lint passes with no errors; vitest reports all suites passing (the move is behavior-neutral, so the green/red status must be identical to before).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(web): move color-label-menu + add-to-album-dialog to components/photo-actions"
```

---

## Task 2: Build the search results toolbar + bulk actions

Rewrite `search-view.tsx` to add the inline two-state toolbar row and wire selection into the existing `PhotoGrid`. The bulk-action handlers (`handleDelete`, `handleDownload`, `applyLabel`) are ported verbatim from `library-view.tsx:35-100`. The query-change reset effect is the only genuinely new logic.

**Files:**
- Modify (full rewrite): `apps/web/src/app/(app)/search/search-view.tsx`

- [ ] **Step 1: Replace the entire contents of `search-view.tsx`**

Write this exact content:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { useGridColumns } from "@/lib/use-grid-columns";
import { useGridSort } from "@/lib/use-grid-sort";
import { useGridView } from "@/lib/use-grid-view";
import { useGridSelection } from "@/lib/use-grid-selection";
import { downloadSelection } from "@/lib/download-client";
import { GridSortMenu } from "@/components/grid-sort-menu";
import { GridSizeMenu } from "@/components/grid-size-menu";
import { GridViewMenu } from "@/components/grid-view-menu";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-dialog";
import { ColorLabelMenu } from "@/components/photo-actions/color-label-menu";
import { AddToAlbumDialog } from "@/components/photo-actions/add-to-album-dialog";
import type { ColorLabel } from "@lumio/shared";
import { cn } from "@/lib/utils";
import { PhotoGrid, type PhotoGridHandle } from "@/components/photo-grid/photo-grid";
import { SearchInput, type SearchInputHandle } from "./search-input";
import { SearchEmpty } from "./search-empty";
import { RecentSearches, loadRecentSearches, recordRecentSearch } from "./recent-searches";
import { type SearchFilters, paramsFor, scopeQuery, serialize } from "./filters";

const EMPTY: SearchFilters = { albums: [], q: "" };

function isEmptyFilters(f: SearchFilters): boolean {
  return f.albums.length === 0 && f.q === "";
}

export function SearchView() {
  // `active` flips on first focus: the box rises to the top and the panel shows.
  const [active, setActive] = useState(false);
  // Live filters, updated (debounced) as the user types / tags.
  const [filters, setFilters] = useState<SearchFilters>(EMPTY);
  // Lazy init (not an effect) reads localStorage once on mount. Safe for SSR/
  // hydration: recents only render after focus, long after the initial paint.
  const [recent, setRecent] = useState<SearchFilters[]>(loadRecentSearches);
  const inputRef = useRef<SearchInputHandle>(null);
  const { columns, setColumns } = useGridColumns();
  const { sort, setSort } = useGridSort();
  const { mode, setMode } = useGridView();
  const sel = useGridSelection();
  const gridRef = useRef<PhotoGridHandle>(null);
  const { confirm, confirmDialog } = useConfirm();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [labelPending, setLabelPending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const empty = isEmptyFilters(filters);

  // The result set changes when the query changes, so any selection would point
  // at photos no longer shown. Drop it and leave select mode whenever the query
  // changes. Keyed on the serialized filters — the same value that remounts the
  // grid below — so the toolbar resets in lockstep with the grid. `sel.cancel`
  // is stable (useCallback), so this only fires on an actual query change; the
  // first run (initial filters) is a harmless no-op.
  const serialized = serialize(filters);
  useEffect(() => {
    sel.cancel();
  }, [serialized, sel.cancel]);

  function handleCommit(f: SearchFilters) {
    if (!isEmptyFilters(f)) setRecent(recordRecentSearch(f));
  }

  function applyRecent(f: SearchFilters) {
    setFilters(f);
    inputRef.current?.applyFilters(f);
  }

  async function handleDelete() {
    const ids = sel.selected;
    if (ids.size === 0 || deleting) return;
    const label = `${ids.size} ${ids.size === 1 ? "photo" : "photos"}`;
    const ok = await confirm({
      title: `Move ${label} to Trash?`,
      description: "They'll be moved to Trash. You can restore them later.",
      confirmLabel: "Move to Trash",
      destructive: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/photos/trash", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [...ids] }),
      });
      if (!res.ok) throw new Error("trash failed");
      // Drop the tiles in place (no remount) and leave select mode.
      gridRef.current?.removePhotos(ids);
      sel.cancel();
    } catch {
      toast.error("Failed to move photos to Trash.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleDownload() {
    const ids = [...sel.selected];
    if (ids.length === 0 || downloading) return;
    setDownloading(true);
    try {
      await downloadSelection(ids);
      // Clear the selection on success while staying in select mode, mirroring
      // the color-label flow — the batch is done, but you may pick another set.
      sel.clear();
    } catch {
      toast.error("Failed to download photos.");
    } finally {
      setDownloading(false);
    }
  }

  async function applyLabel(label: ColorLabel | null) {
    if (labelPending) return;
    const ids = sel.selected;
    setLabelPending(true);
    try {
      const res = await fetch("/api/photos/color-label", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ photoIds: [...ids], label }),
      });
      if (!res.ok) throw new Error("label failed");
      // Optimistically repaint the client-fetched grid, then clear the
      // selection while staying in select mode so the user can keep labeling.
      gridRef.current?.patchPhotos(ids, { colorLabel: label });
      sel.clear();
    } catch {
      toast.error("Failed to apply label.");
    } finally {
      setLabelPending(false);
    }
  }

  return (
    <>
      {confirmDialog}
      <div
        className={cn(
          // Center the box on entry by padding the top; collapse the padding when
          // active so it rises to the top. Animating padding (not a transform) keeps
          // the box in flow, so its sticky header band never sweeps over the grid.
          "transition-[padding] duration-500 ease-out",
          active ? "pt-0" : "pt-[32vh]",
        )}
      >
        {/* Sticky search header. The full-width band (-mx-6/px-6 bg-background) only
            paints once active, so the centered hero shows just the pill — no stripe. */}
        <div
          className={cn(
            "sticky top-0 z-20 -mx-6 px-6 transition-colors duration-300",
            active ? "bg-background py-3" : "py-0",
          )}
        >
          <div className="mx-auto w-full max-w-2xl">
            <div
              className={cn(
                "overflow-hidden text-center transition-all duration-300",
                active ? "max-h-0 opacity-0" : "mb-6 max-h-40 opacity-100",
              )}
            >
              <h1 className="text-3xl font-semibold">Search library</h1>
              <p className="mt-2 text-sm text-muted-foreground">Type @ to filter by album</p>
            </div>
            <SearchInput
              ref={inputRef}
              compact={active}
              onActivate={() => setActive(true)}
              onChange={setFilters}
              onCommit={handleCommit}
            />
          </div>
        </div>

        {active &&
          (empty ? (
            // Empty query: don't search — surface recent searches instead.
            <RecentSearches items={recent} onPick={applyRecent} />
          ) : (
            <div className="pt-2">
              {/* Two-state toolbar row. Inline (not the sticky HeaderBar/SelectionToolbar)
                  because the sticky search box already owns top-0 above. */}
              <div className="mb-2 flex items-center justify-between gap-4">
                {sel.selectMode ? (
                  <span className="text-sm font-medium">
                    {sel.count > 0 ? `${sel.count} selected` : "Select photos"}
                  </span>
                ) : (
                  <span />
                )}
                <div className="flex items-center gap-2">
                  {sel.selectMode ? (
                    <>
                      <ColorLabelMenu
                        disabled={sel.count === 0 || labelPending}
                        onPick={(label) => void applyLabel(label)}
                      />
                      <Button
                        size="sm"
                        disabled={sel.count === 0}
                        onClick={() => setDialogOpen(true)}
                      >
                        Add to album
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={sel.count === 0 || downloading}
                        onClick={() => void handleDownload()}
                      >
                        <Download aria-hidden />
                        {downloading ? "Preparing…" : "Download"}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={sel.count === 0 || deleting}
                        onClick={() => void handleDelete()}
                      >
                        {deleting ? "Deleting…" : "Delete"}
                      </Button>
                      <Button variant="outline" size="sm" onClick={sel.cancel}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <GridViewMenu mode={mode} onModeChange={setMode} />
                      <GridSizeMenu columns={columns} onColumnsChange={setColumns} />
                      <GridSortMenu sort={sort} onSortChange={setSort} />
                      <Button variant="outline" size="sm" onClick={sel.enter}>
                        Select
                      </Button>
                    </>
                  )}
                </div>
              </div>
              <PhotoGrid
                key={`${serialize(filters)}:${sort}`}
                apiRef={gridRef}
                mode={mode}
                columns={columns}
                endpoint="/api/search"
                params={paramsFor(filters, sort)}
                hrefFor={(id) => `/photo/${id}?${scopeQuery(filters, sort)}`}
                empty={<SearchEmpty />}
                selectMode={sel.selectMode}
                selectedIds={sel.selected}
                onSelectionChange={sel.setSelected}
              />
            </div>
          ))}
      </div>

      <AddToAlbumDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        photoIds={[...sel.selected]}
        onAdded={() => {
          setDialogOpen(false);
          sel.cancel();
        }}
      />
    </>
  );
}
```

- [ ] **Step 2: Lint + typecheck (build)**

Run from repo root:

```bash
pnpm --filter @lumio/web lint
pnpm --filter @lumio/web build
```

Expected: lint passes; `next build` completes with no TypeScript errors. Watch specifically for:
- unused-import errors (every import above is used),
- the `useEffect` dependency lint — `[serialized, sel.cancel]` is correct (`sel.cancel` is a stable `useCallback`), so there should be **no** `react-hooks/exhaustive-deps` warning. If one appears, do not add `sel` to the deps (it's a fresh object each render and would loop); the warning would indicate a real mismatch to investigate.

- [ ] **Step 3: Run the existing test suite (regression)**

Run from repo root:

```bash
pnpm --filter @lumio/web test
```

Expected: all suites pass (no test file changed; this confirms nothing the search view shares — `filters`, hooks — regressed).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(app\)/search/search-view.tsx
git commit -m "feat(web): search results toolbar — grid controls + select + bulk actions"
```

---

## Task 3: Verify behavior in the browser

No code changes — confirm the feature works end-to-end, the way prior UI features in this repo were validated. Start the dev server, then walk the checklist.

**Files:** none.

- [ ] **Step 1: Start the app**

Run from repo root:

```bash
pnpm dev
```

Then open the search page (e.g. `http://localhost:3000/search`). Note: photos must exist in the library (run `pnpm seed` first if the library is empty — destructive, dev only).

- [ ] **Step 2: Walk the verification checklist**

Confirm each, ideally recording a short GIF of the select → bulk-action flow:

- **Empty query:** focusing the box shows recent searches and **no toolbar / no Select** (unchanged).
- **Active query with results:** the toolbar row appears under the search box, right-aligned: **Grid view · Grid size · Sort · Select**.
- **Grid view / size / sort** each change the grid as on Library (view mode, column count, sort order).
- **Select** enters select mode: left shows "Select photos", then "N selected" as you click/shift-click tiles; right shows **Color label · Add to album · Download · Delete · Cancel** (all disabled at 0 selected except Cancel).
- **Color label** applies a label to the selected tiles (tint appears), selection clears, stays in select mode.
- **Add to album** opens the dialog; adding closes it and exits select mode.
- **Download** downloads the selection (single → file, multiple → zip), selection clears, stays in select mode.
- **Delete** confirms, moves photos to Trash, tiles disappear from the results in place, exits select mode. Confirm the photos appear in `/trash`.
- **Cancel** (and **Escape**) exits select mode and clears selection.
- **Query change while selecting:** with a selection active, edit the query — select mode exits and the selection resets (no stale state).
- **Clear the query:** returns to recent searches with no toolbar.

- [ ] **Step 3: Report results**

State plainly which checklist items passed and surface any that failed with the observed behavior. If all pass, the feature is complete.

---

## Self-Review Notes

- **Spec coverage:** Layout/results-row toolbar → Task 2. Normal-mode controls + select-mode actions → Task 2. Component move + 3 import sites → Task 1. Selection/view wiring into `PhotoGrid` → Task 2. Query-change reset effect → Task 2 (Step 1, the `useEffect`). Verification (suite green + lint + build + browser) → Tasks 1–3. Out-of-scope items (`SelectionToolbar` move, query/endpoint changes, "remove from album") are correctly untouched.
- **No new component tests** is intentional and documented above — the repo has no component-test harness, and this feature adds no extractable pure logic.
- **Type consistency:** `PhotoGridHandle` with `removePhotos(ids: Set<string>)` / `patchPhotos(ids: Set<string>, patch)` matches `photo-grid.tsx:39-44`. `useConfirm()` → `{ confirm, confirmDialog }`, `useGridView()` → `{ mode, setMode }`, `useGridColumns()` → `{ columns, setColumns }`, `useGridSelection()` → `{ selectMode, selected, setSelected, enter, cancel, clear, count }` — all match their definitions. `applyLabel(label: ColorLabel | null)` matches `ColorLabelMenu`'s `onPick` and the Library handler.
