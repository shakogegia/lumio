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

## Task 4: Result count in the toolbar's title slot

Show the total photos matching the current search in the toolbar's left slot
(normal mode). Needs a backend count (search has no total). Backend gets a unit
test (this repo tests services); the client hook does not (repo has no
fetch-mocking/hook-fetch test harness — consistent with `usePhotoPages` etc.).

**Files:**
- Modify: `packages/shared/src/api.ts` (add `SearchCount` type)
- Modify: `apps/web/src/lib/search-service.ts` (add `countSearchPhotos`)
- Test: `apps/web/src/lib/search-service.test.ts` (add `countSearchPhotos` cases)
- Modify: `apps/web/src/app/api/search/route.ts` (add `count=1` branch)
- Create: `apps/web/src/app/(app)/search/use-search-count.ts`
- Modify: `apps/web/src/app/(app)/search/search-view.tsx`

- [ ] **Step 1: Add the `SearchCount` type to shared**

In `packages/shared/src/api.ts`, immediately after the `export type SearchQuery = ...` line, add:

```ts
/** Response for GET /api/search?count=1 — total photos matching the filters. */
export interface SearchCount {
  total: number;
}
```

- [ ] **Step 2: Write the failing test for `countSearchPhotos`**

In `apps/web/src/lib/search-service.test.ts`, add these cases (a `count`-mocking db; mirrors the existing `fakeDb` style). Append after the existing `describe("searchPhotos", ...)` block, and add the import at the top:

Change the import line:
```ts
import { searchPhotos } from "./search-service.js";
```
to:
```ts
import { countSearchPhotos, searchPhotos } from "./search-service.js";
```

Append:
```ts
function fakeCountDb(total: number) {
  const calls: Array<{ where?: unknown }> = [];
  return {
    calls,
    photo: {
      count: async (args: { where?: unknown }) => {
        calls.push(args);
        return total;
      },
    },
  };
}

describe("countSearchPhotos", () => {
  it("counts with the same where as searchPhotos (album + q)", async () => {
    const db = fakeCountDb(42);
    const total = await countSearchPhotos({ limit: 50, album: ["alb1"], q: "beach" }, db as never);
    expect(total).toBe(42);
    expect(db.calls[0]?.where).toEqual({
      AND: [
        { albums: { some: { albumId: { in: ["alb1"] } } } },
        { path: { contains: "beach", mode: "insensitive" } },
      ],
    });
  });

  it("uses an empty where when there are no filters", async () => {
    const db = fakeCountDb(0);
    const total = await countSearchPhotos({ limit: 50, album: [] }, db as never);
    expect(total).toBe(0);
    expect(db.calls[0]?.where).toEqual({});
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @lumio/web test -- search-service`
Expected: FAIL — `countSearchPhotos` is not exported yet.

- [ ] **Step 4: Implement `countSearchPhotos`**

In `apps/web/src/lib/search-service.ts`, append after `searchPhotos`:

```ts
/**
 * Count photos matching the search filters — same `where` as `searchPhotos`,
 * minus pagination. Powers the result count shown in the search toolbar.
 */
export async function countSearchPhotos(params: SearchQuery, db: Db = prisma): Promise<number> {
  return db.photo.count({ where: buildSearchWhere(params) });
}
```

(`buildSearchWhere`, `SearchQuery`, `prisma`, and the `Db` type are already imported/defined in this file.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @lumio/web test -- search-service`
Expected: PASS — all `searchPhotos` and `countSearchPhotos` cases green.

- [ ] **Step 6: Add the `count=1` branch to the search route**

In `apps/web/src/app/api/search/route.ts`, update the import and add the branch.

Change:
```ts
import { searchPhotos } from "@/lib/search-service";
```
to:
```ts
import { countSearchPhotos, searchPhotos } from "@/lib/search-service";
```

Then, right after the `if (!parsed.success) { ... }` block and before `const page = await searchPhotos(parsed.data);`, insert:
```ts
  // Lightweight count mode for the search toolbar: same filters, no pagination.
  if (searchParams.get("count")) {
    const total = await countSearchPhotos(parsed.data);
    return NextResponse.json({ total });
  }
```

- [ ] **Step 7: Create the `useSearchCount` hook**

Create `apps/web/src/app/(app)/search/use-search-count.ts`:

```ts
"use client";

import { useEffect, useState } from "react";
import type { SearchCount } from "@lumio/shared";
import { type SearchFilters, paramsFor, serialize } from "./filters";

/**
 * Total photos matching the current search filters, for the toolbar count.
 * Fetches `GET /api/search?count=1` when the (serialized) filters change —
 * sort-independent, so it never refetches on a sort change. Returns `null`
 * while loading, when disabled, or on error. Exposes the setter so the view
 * can keep the count in sync with in-place tile removal (e.g. after a delete).
 */
export function useSearchCount(filters: SearchFilters, enabled: boolean) {
  const [count, setCount] = useState<number | null>(null);
  const serialized = serialize(filters);

  useEffect(() => {
    if (!enabled) {
      setCount(null);
      return;
    }
    let cancelled = false;
    setCount(null);
    const params = paramsFor(filters);
    params.set("count", "1");
    fetch(`/api/search?${params.toString()}`)
      .then((res) => (res.ok ? (res.json() as Promise<SearchCount>) : Promise.reject(new Error())))
      .then((data) => {
        if (!cancelled) setCount(data.total);
      })
      .catch(() => {
        if (!cancelled) setCount(null);
      });
    return () => {
      cancelled = true;
    };
    // `serialized` is the stable identity of `filters`; refetch only when it
    // changes (or `enabled` flips). `filters`/`paramsFor` are intentionally
    // excluded — they'd refetch every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized, enabled]);

  return [count, setCount] as const;
}
```

- [ ] **Step 8: Wire the count into `search-view.tsx`**

Add the import (near the other `./` imports):
```ts
import { useSearchCount } from "./use-search-count";
```

Add the hook call right after `const empty = isEmptyFilters(filters);`:
```ts
  const [searchCount, setSearchCount] = useSearchCount(filters, active && !empty);
```

In the toolbar's left slot, replace the normal-mode placeholder. Change:
```tsx
                {sel.selectMode ? (
                  <span className="text-sm font-medium">
                    {sel.count > 0 ? `${sel.count} selected` : "Select photos"}
                  </span>
                ) : (
                  <span />
                )}
```
to:
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

In `handleDelete`, after `gridRef.current?.removePhotos(ids);`, keep the count in sync — add:
```tsx
      // Keep the toolbar count consistent with the tiles we just removed.
      setSearchCount((c) => (c === null ? c : Math.max(0, c - ids.size)));
```
(Place it right after `gridRef.current?.removePhotos(ids);` and before `sel.cancel();`.)

- [ ] **Step 9: Lint + typecheck + tests**

Run from repo root:
```bash
pnpm --filter @lumio/web lint
pnpm --filter @lumio/web exec tsc --noEmit
pnpm --filter @lumio/web test
```
Also build the shared package if needed so the new `SearchCount` type resolves: if `tsc` errors on the `@lumio/shared` import, run `pnpm --filter @lumio/shared build` first, then re-run. Expected: lint clean, no type errors, all tests pass (including the 2 new count cases).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(web): show matching-photo count in the search toolbar"
```

## Self-Review Notes

- **Spec coverage:** Layout/results-row toolbar → Task 2. Normal-mode controls + select-mode actions → Task 2. Component move + 3 import sites → Task 1. Selection/view wiring into `PhotoGrid` → Task 2. Query-change reset effect → Task 2 (Step 1, the `useEffect`). Verification (suite green + lint + build + browser) → Tasks 1–3. Out-of-scope items (`SelectionToolbar` move, query/endpoint changes, "remove from album") are correctly untouched.
- **No new component tests** is intentional and documented above — the repo has no component-test harness, and this feature adds no extractable pure logic.
- **Type consistency:** `PhotoGridHandle` with `removePhotos(ids: Set<string>)` / `patchPhotos(ids: Set<string>, patch)` matches `photo-grid.tsx:39-44`. `useConfirm()` → `{ confirm, confirmDialog }`, `useGridView()` → `{ mode, setMode }`, `useGridColumns()` → `{ columns, setColumns }`, `useGridSelection()` → `{ selectMode, selected, setSelected, enter, cancel, clear, count }` — all match their definitions. `applyLabel(label: ColorLabel | null)` matches `ColorLabelMenu`'s `onPick` and the Library handler.
