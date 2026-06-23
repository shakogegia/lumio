# Photo action consolidation + PhotoLibraryView + folder grid — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every photo mutation single-sourced, extract the duplicated grid composition into one reusable `PhotoLibraryView`, and rebuild `/folders` as Folders + the real photo grid scoped to the folder.

**Architecture:** Phase 1 adds `lib/photo-mutations.ts` (one fetch per mutation) and reroutes all callers. Phase 2 extracts `PhotoLibraryView` (+ shared `SelectionActions`) and migrates four views onto it. Phase 3 rebuilds the `/folders` page on `PhotoLibraryView` and removes last round's folder-specific UI.

**Tech Stack:** Next.js 16 App Router, React, TanStack window virtualizer, Prisma/Postgres, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-22-folder-explorer-photo-grid-design.md`

### Refinements discovered during planning (vs the spec)
1. **`library-view` and `album-view` have a month/calendar filter** (`GridCalendarMenu` + `month` state + month in params). So `PhotoLibraryView` can't be `makeScope(sort)`-only. **It takes a `collection({sort, month}) => PhotoCollectionSource` builder + an optional `calendar` prop.** Each view builds its own endpoint/params (faithful to today).
2. Because the collection is endpoint-based, **favorites stays endpoint-based** (`/photos?favorite=true`); the spec's "add a `favorites` DetailScope kind" is **dropped as unnecessary** (favorites deep-links keep today's behavior).
3. **Selection-clear behavior is unified to match library/album/folder:** download + trash clear the selection; favorite/label/add-to-album keep it. Favorites loses only its prior "clear on favorite" nuance (its `dropOnUnfavorite` still removes unfavorited tiles). Minor, deliberate.

### File structure
- Create `apps/web/src/lib/photo-mutations.ts` (+ `.test.ts`) — the one-fetch-per-mutation network layer.
- Modify callers: `components/photo-actions/use-photo-actions.tsx`, `components/photo-actions/use-add-to-album.tsx`, `components/photo-actions/add-to-album-dialog.tsx`, `components/photo-grid/use-favorite.ts`, `components/photo-grid/lightbox-actions.tsx`, `components/photo-grid/lightbox-sidebar.tsx`.
- Move `app/(app)/c/[catalog]/photos/selection-toolbar.tsx` → `components/photo-actions/selection-toolbar.tsx`.
- Create `components/photo-actions/selection-actions.tsx` — the shared bulk-button row.
- Create `components/photo-library/photo-library-view.tsx` — the reusable view.
- Migrate `photos/library-view.tsx`, `albums/[id]/album-view.tsx`, `albums/folder/[id]/photos/folder-photos-view.tsx`, `favorites/favorites-view.tsx` to thin wrappers.
- Phase 3: `lib/catalog-fs-service.ts` (+test), `lib/catalog-fs.ts` (+test), `lib/detail-scope.ts` (+test), `lib/photo-collection-scope.ts`, `lib/photo-order.ts`, `lib/photos-service.ts`, `lib/locate-photo.ts` (+test), `api/c/[catalog]/fs/photos/route.ts`, `app/(app)/c/[catalog]/folders/{page.tsx,folder-explorer.tsx,folders-section.tsx,folder-breadcrumb.tsx}`; delete `lib/folder-prefs.ts`(+test), `lib/use-folder-prefs.ts`, `api/c/[catalog]/fs/search/route.ts`.

---

## PHASE 1 — One network call per mutation

### Task 1.1: `photo-mutations.ts` module

**Files:**
- Create: `apps/web/src/lib/photo-mutations.ts`
- Test: `apps/web/src/lib/photo-mutations.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/lib/photo-mutations.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addPhotosToAlbum,
  createAlbum,
  favoritePhotos,
  removePhotoFromAlbum,
  setPhotoColorLabel,
  trashPhotos,
} from "./photo-mutations.js";

function mockFetch(ok = true, body: unknown = {}) {
  const fn = vi.fn(async () => ({ ok, json: async () => body }) as Response);
  vi.stubGlobal("fetch", fn);
  return fn;
}
afterEach(() => vi.unstubAllGlobals());

describe("photo-mutations", () => {
  it("favoritePhotos POSTs ids + flag", async () => {
    const f = mockFetch();
    await favoritePhotos("fam", ["a", "b"], true);
    expect(f).toHaveBeenCalledWith("/api/c/fam/photos/favorite", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ photoIds: ["a", "b"], isFavorite: true }),
    }));
  });

  it("setPhotoColorLabel POSTs ids + label", async () => {
    const f = mockFetch();
    await setPhotoColorLabel("fam", ["a"], "pink");
    expect(f).toHaveBeenCalledWith("/api/c/fam/photos/color-label", expect.objectContaining({
      body: JSON.stringify({ photoIds: ["a"], label: "pink" }),
    }));
  });

  it("trashPhotos POSTs ids", async () => {
    const f = mockFetch();
    await trashPhotos("fam", ["a"]);
    expect(f).toHaveBeenCalledWith("/api/c/fam/photos/trash", expect.objectContaining({
      body: JSON.stringify({ ids: ["a"] }),
    }));
  });

  it("addPhotosToAlbum POSTs to the album", async () => {
    const f = mockFetch();
    await addPhotosToAlbum("fam", "alb1", ["a", "b"]);
    expect(f).toHaveBeenCalledWith("/api/c/fam/albums/alb1/photos", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ photoIds: ["a", "b"] }),
    }));
  });

  it("removePhotoFromAlbum DELETEs the member", async () => {
    const f = mockFetch();
    await removePhotoFromAlbum("fam", "alb1", "a");
    expect(f).toHaveBeenCalledWith("/api/c/fam/albums/alb1/photos/a", expect.objectContaining({ method: "DELETE" }));
  });

  it("createAlbum POSTs the name and returns the row", async () => {
    const f = mockFetch(true, { id: "new1" });
    const out = await createAlbum("fam", "Trip");
    expect(f).toHaveBeenCalledWith("/api/c/fam/albums", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ name: "Trip" }),
    }));
    expect(out).toEqual({ id: "new1" });
  });

  it("throws on a non-OK response", async () => {
    mockFetch(false);
    await expect(favoritePhotos("fam", ["a"], true)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/photo-mutations.test.ts`
Expected: FAIL — cannot find `./photo-mutations.js`.

- [ ] **Step 3: Implement**

```ts
// apps/web/src/lib/photo-mutations.ts
import type { ColorLabel } from "@lumio/shared";
import { catalogApiUrl } from "@/lib/catalog-api";

// Single source of truth for photo-mutation network calls. Each function issues
// exactly one request and throws on failure. Callers own optimistic UI, toasts,
// sounds, and router.refresh — those vary by context, the request does not.

async function postJson(url: string, body: unknown): Promise<Response> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res;
}

export async function favoritePhotos(slug: string, photoIds: string[], isFavorite: boolean): Promise<void> {
  await postJson(catalogApiUrl(slug, "/photos/favorite"), { photoIds, isFavorite });
}

export async function setPhotoColorLabel(slug: string, photoIds: string[], label: ColorLabel | null): Promise<void> {
  await postJson(catalogApiUrl(slug, "/photos/color-label"), { photoIds, label });
}

export async function trashPhotos(slug: string, ids: string[]): Promise<void> {
  await postJson(catalogApiUrl(slug, "/photos/trash"), { ids });
}

export async function addPhotosToAlbum(slug: string, albumId: string, photoIds: string[]): Promise<void> {
  await postJson(catalogApiUrl(slug, `/albums/${albumId}/photos`), { photoIds });
}

export async function removePhotoFromAlbum(slug: string, albumId: string, photoId: string): Promise<void> {
  const res = await fetch(catalogApiUrl(slug, `/albums/${albumId}/photos/${photoId}`), { method: "DELETE" });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
}

export async function createAlbum(slug: string, name: string): Promise<{ id: string }> {
  const res = await postJson(catalogApiUrl(slug, "/albums"), { name });
  return (await res.json()) as { id: string };
}
```

> Before writing, confirm the exact endpoint shapes match the current callers (read `use-photo-actions.tsx`, `use-add-to-album.tsx`, `add-to-album-dialog.tsx`, `lightbox-actions.tsx`, `lightbox-sidebar.tsx`, `use-favorite.ts`). If `add-to-album-dialog` or `lightbox-sidebar` use a different add/remove endpoint shape, adjust these functions to match the **real** endpoints (do not change the API routes).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/photo-mutations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/photo-mutations.ts apps/web/src/lib/photo-mutations.test.ts
git commit -m "feat(web): photo-mutations — single network layer for photo actions"
```

### Task 1.2: Route `use-photo-actions.tsx` through the module

**Files:** Modify `apps/web/src/components/photo-actions/use-photo-actions.tsx`

- [ ] **Step 1: Replace the inline fetches** with module calls, keeping the surrounding optimistic patch / toast / sound / guard exactly as-is.
  - Add import: `import { favoritePhotos, setPhotoColorLabel, trashPhotos } from "@/lib/photo-mutations";`
  - In `applyLabel`: replace the `fetch(catalogApiUrl(slug, "/photos/color-label"), {…}); if (!res.ok) throw …` block with `await setPhotoColorLabel(slug, ids, label);` (keep the surrounding `try` + `gridRef.current?.patchPhotos(...)` + toast).
  - In `favorite`: replace the favorite `fetch` block with `await favoritePhotos(slug, ids, isFavorite);` (keep the `dropOnUnfavorite`/patch branch + toast).
  - In `trash`: replace the trash `fetch` block with `await trashPhotos(slug, ids);` (keep confirm + removePhotos + sound + onTrashed + toast).
  - Remove the now-unused `catalogApiUrl` import **only if** nothing else in the file uses it (the album-cover `PATCH` still does — keep it).

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit 2>&1 | grep 'error TS' | grep -v calendar.ts`
Expected: empty.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/photo-actions/use-photo-actions.tsx
git commit -m "refactor(web): use-photo-actions via photo-mutations"
```

### Task 1.3: Route `use-favorite.ts`, `lightbox-actions.tsx`, `use-add-to-album.tsx`, `add-to-album-dialog.tsx`, `lightbox-sidebar.tsx`

**Files:** Modify each of those five.

- [ ] **Step 1: Swap each inline fetch for the module call**, preserving each caller's optimistic update + toast + sound + refresh:
  - `components/photo-grid/use-favorite.ts`: `favoritePhotos(slug, [photo.id], next)` then `patchPhotos(...)`.
  - `components/photo-grid/lightbox-actions.tsx` (`trash`): `await trashPhotos(slug, [photo.id])` then `removePhotos(...)` + `onTrashed()`.
  - `components/photo-actions/use-add-to-album.tsx` (`addToAlbumDirect`): `await addPhotosToAlbum(slug, albumId, ids)` then `router.refresh()` + sound + onSuccess.
  - `components/photo-actions/add-to-album-dialog.tsx`: use `createAlbum(slug, name)` for the new-album path and `addPhotosToAlbum(slug, albumId, photoIds)` for the add; keep the dialog's success/refresh handling.
  - `components/photo-grid/lightbox-sidebar.tsx`: the "Appears in" add/remove → `addPhotosToAlbum(slug, albumId, [photo.id])` / `removePhotoFromAlbum(slug, albumId, photo.id)`. **Read the current code first** — if it toggles via one endpoint with a method switch, map add→`addPhotosToAlbum`, remove→`removePhotoFromAlbum`; keep its local state update.

  Remove now-unused `catalogApiUrl` imports per file only where nothing else uses them.

- [ ] **Step 2: Typecheck + targeted lint**

Run: `pnpm --filter @lumio/web exec tsc --noEmit 2>&1 | grep 'error TS' | grep -v calendar.ts` → empty
Run: `pnpm --filter @lumio/web exec eslint src/components/photo-grid/use-favorite.ts src/components/photo-grid/lightbox-actions.tsx src/components/photo-actions/use-add-to-album.tsx src/components/photo-actions/add-to-album-dialog.tsx src/components/photo-grid/lightbox-sidebar.tsx` → no new errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/photo-grid/use-favorite.ts apps/web/src/components/photo-grid/lightbox-actions.tsx apps/web/src/components/photo-actions/use-add-to-album.tsx apps/web/src/components/photo-actions/add-to-album-dialog.tsx apps/web/src/components/photo-grid/lightbox-sidebar.tsx
git commit -m "refactor(web): route lightbox/tile/dialog actions via photo-mutations"
```

### Task 1.4: Verify Phase 1 (no behavior change)

- [ ] **Step 1:** `pnpm --filter @lumio/web test` → all pass.
- [ ] **Step 2:** `pnpm --filter @lumio/web exec tsc --noEmit 2>&1 | grep 'error TS' | grep -v calendar.ts` → empty.
- [ ] **Step 3:** `grep -rn "photos/favorite\|photos/trash\|photos/color-label" apps/web/src --include=*.ts --include=*.tsx | grep -v photo-mutations.ts` → only non-fetch references (no stray `fetch(`). Confirm the only place issuing these requests is `photo-mutations.ts`.

---

## PHASE 2 — `PhotoLibraryView` + shared actions + migrations

### Task 2.1: Move `selection-toolbar.tsx` to the shared location

**Files:** `git mv app/(app)/c/[catalog]/photos/selection-toolbar.tsx components/photo-actions/selection-toolbar.tsx`

- [ ] **Step 1:** `git mv "apps/web/src/app/(app)/c/[catalog]/photos/selection-toolbar.tsx" apps/web/src/components/photo-actions/selection-toolbar.tsx`
- [ ] **Step 2:** Update imports in the four files that import it (`library-view`, `album-view`, `folder-photos-view`, `favorites-view`) from `./selection-toolbar` / `@/app/(app)/c/[catalog]/photos/selection-toolbar` → `@/components/photo-actions/selection-toolbar`. Find them: `grep -rln "selection-toolbar" apps/web/src`.
- [ ] **Step 3:** Typecheck (`… | grep 'error TS' | grep -v calendar.ts` empty), then commit:
```bash
git add -A && git commit -m "refactor(web): move SelectionToolbar to components/photo-actions"
```

### Task 2.2: `SelectionActions` — shared bulk-button row

**Files:** Create `apps/web/src/components/photo-actions/selection-actions.tsx`

- [ ] **Step 1: Implement** (extracted verbatim from `library-view`'s toolbar `actions`, parameterized):

```tsx
// apps/web/src/components/photo-actions/selection-actions.tsx
"use client";

import { Download, Loader2, Trash2 } from "lucide-react";
import { computeFavoriteTarget } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import { FavoriteButton } from "@/components/photo-actions/favorite-button";
import { ColorLabelMenu } from "@/components/photo-actions/color-label-menu";
import { AddToAlbumMenu } from "@/components/photo-actions/add-to-album-menu";
import type { PhotoActions } from "@/components/photo-actions/use-photo-actions";
import type { PhotoGridHandle } from "@/components/photo-grid/photo-grid";

/**
 * The standard bulk-action button set shared by every photo library view:
 * favorite, color label, add-to-album, download, trash. Wired to usePhotoActions
 * + the selection. Download and trash clear the selection on success (the
 * terminal actions); favorite/label/add keep it so you can chain edits.
 */
export function SelectionActions({
  actions,
  selectedIds,
  gridRef,
  clearSelection,
}: {
  actions: PhotoActions;
  selectedIds: Set<string>;
  gridRef: React.RefObject<PhotoGridHandle | null>;
  clearSelection: () => void;
}) {
  const ids = [...selectedIds];
  const none = ids.length === 0;
  return (
    <>
      <FavoriteButton
        disabled={none || actions.pending.favorite}
        pending={actions.pending.favorite}
        onClick={() => {
          const target = computeFavoriteTarget(gridRef.current?.getPhotos(selectedIds) ?? []);
          void actions.favorite(ids, target);
        }}
      />
      <ColorLabelMenu
        disabled={none || actions.pending.label}
        onPick={(label) => void actions.applyLabel(ids, label)}
      />
      <AddToAlbumMenu
        disabled={none}
        excludeAlbumId={actions.excludeAlbumId}
        onPick={(albumId) => void actions.addToAlbumDirect(ids, albumId)}
        onCreateNew={() => actions.addToAlbum(ids)}
      />
      <Button
        variant="outline"
        size="icon-sm"
        disabled={none || actions.pending.download}
        onClick={() => void actions.download(ids, { onSuccess: clearSelection })}
        aria-label="Download"
        title="Download"
      >
        {actions.pending.download ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
      </Button>
      <Button
        variant="destructive"
        size="icon-sm"
        disabled={none || actions.pending.trash}
        onClick={() => void actions.trash(ids, { onSuccess: clearSelection })}
        aria-label="Delete"
        title="Delete"
      >
        {actions.pending.trash ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
      </Button>
    </>
  );
}
```

- [ ] **Step 2:** Typecheck (empty), commit:
```bash
git add apps/web/src/components/photo-actions/selection-actions.tsx
git commit -m "feat(web): shared SelectionActions bulk-button row"
```

### Task 2.3: `PhotoLibraryView`

**Files:** Create `apps/web/src/components/photo-library/photo-library-view.tsx`

- [ ] **Step 1: Implement** (the composition extracted from `library-view`, generalized via a `collection` builder + optional `calendar`):

```tsx
// apps/web/src/components/photo-library/photo-library-view.tsx
"use client";

import { useRef, useState } from "react";
import type { PhotoSort } from "@lumio/shared";
import { useGridSelection } from "@/lib/use-grid-selection";
import { useGridView } from "@/lib/use-grid-view";
import { useGridColumns } from "@/lib/use-grid-columns";
import { useGridSort } from "@/lib/use-grid-sort";
import { GridViewMenu } from "@/components/grid-view-menu";
import { GridSizeMenu } from "@/components/grid-size-menu";
import { GridSortMenu } from "@/components/grid-sort-menu";
import { GridCalendarMenu } from "@/components/grid-calendar-menu";
import { PhotoGrid, type PhotoGridHandle } from "@/components/photo-grid/photo-grid";
import { PhotoCollectionProvider } from "@/components/photo-grid/photo-collection";
import { CollectionTotalReporter } from "@/components/photo-grid/collection-total-reporter";
import { Lightbox } from "@/components/photo-grid/lightbox";
import { GridShortcuts } from "@/components/photo-grid/grid-shortcuts";
import { countLabel } from "@/lib/count-label";
import { Skeleton } from "@/components/ui/skeleton";
import { HeaderBar } from "@/components/header-bar";
import { SelectionToolbar } from "@/components/photo-actions/selection-toolbar";
import { SelectionActions } from "@/components/photo-actions/selection-actions";
import { usePhotoActions } from "@/components/photo-actions/use-photo-actions";
import { PhotoActionsProvider } from "@/components/photo-actions/photo-actions-context";

/** The paginated source + lightbox URLs for the current sort/month. */
export interface PhotoCollectionSource {
  endpoint: string;
  params: URLSearchParams;
  urlForId: (id: string) => string;
  baseUrl: string;
  /** Forces a provider remount when the filter changes (e.g. `${sort}:${month}`). */
  key: string;
}

export interface PhotoLibraryViewProps {
  /** Build the collection from the grid's current sort + month. */
  collection: (args: { sort: PhotoSort; month: string | null }) => PhotoCollectionSource;
  title: React.ReactNode;
  noun?: [singular: string, plural: string];
  empty?: React.ReactNode;
  /** When set, render the month calendar menu and own the month state. */
  calendar?: { facetsEndpoint: string };
  /** Forwarded to usePhotoActions for view-specific behavior. */
  actionOptions?: {
    excludeAlbumId?: string;
    albumCover?: { albumId: string; coverPhotoId: string | null };
    trashDescription?: string;
    onTrashed?: (ids: string[]) => void;
    dropOnUnfavorite?: boolean;
  };
  /** Rendered between the toolbar and the grid (e.g. the folders section). */
  aboveGrid?: React.ReactNode;
}

export function PhotoLibraryView({
  collection,
  title,
  noun = ["photo", "photos"],
  empty,
  calendar,
  actionOptions,
  aboveGrid,
}: PhotoLibraryViewProps) {
  const sel = useGridSelection();
  const { mode, setMode } = useGridView();
  const { columns, setColumns } = useGridColumns();
  const { sort, setSort } = useGridSort();
  const [month, setMonth] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const gridRef = useRef<PhotoGridHandle>(null);
  const actions = usePhotoActions({ gridRef, ...actionOptions });

  const src = collection({ sort, month });
  const totalLabel = total !== null ? countLabel(total, noun[0], noun[1]) : undefined;
  const countSubtitle = totalLabel ?? <Skeleton className="inline-block h-3 w-16 align-middle" />;

  return (
    <>
      {actions.element}
      {sel.count > 0 ? (
        <SelectionToolbar
          title={title}
          count={sel.count}
          totalLabel={totalLabel}
          onCancel={sel.clear}
          actions={
            <SelectionActions
              actions={actions}
              selectedIds={sel.selected}
              gridRef={gridRef}
              clearSelection={sel.clear}
            />
          }
        />
      ) : (
        <HeaderBar
          title={title}
          subtitle={countSubtitle}
          actions={
            <>
              <GridViewMenu mode={mode} onModeChange={setMode} />
              <GridSizeMenu columns={columns} onColumnsChange={setColumns} />
              <GridSortMenu sort={sort} onSortChange={setSort} />
              {calendar && (
                <GridCalendarMenu
                  facetsEndpoint={calendar.facetsEndpoint}
                  value={month}
                  onChange={setMonth}
                />
              )}
            </>
          }
        />
      )}

      <PhotoCollectionProvider
        key={src.key}
        endpoint={src.endpoint}
        params={src.params}
        urlForId={src.urlForId}
        baseUrl={src.baseUrl}
      >
        <CollectionTotalReporter onTotal={setTotal} />
        <PhotoActionsProvider value={actions}>
          {aboveGrid}
          <PhotoGrid
            apiRef={gridRef}
            mode={mode}
            columns={columns}
            selectedIds={sel.selected}
            onSelectionChange={sel.setSelected}
            empty={empty}
          />
          <Lightbox />
          <GridShortcuts selectedIds={sel.selected} />
        </PhotoActionsProvider>
      </PhotoCollectionProvider>
    </>
  );
}
```

- [ ] **Step 2:** Typecheck (empty). Commit:
```bash
git add apps/web/src/components/photo-library/photo-library-view.tsx
git commit -m "feat(web): reusable PhotoLibraryView"
```

### Task 2.4: Migrate `library-view.tsx`

**Files:** Modify `apps/web/src/app/(app)/c/[catalog]/photos/library-view.tsx`

- [ ] **Step 1: Replace the whole file** with the thin wrapper:

```tsx
// apps/web/src/app/(app)/c/[catalog]/photos/library-view.tsx
"use client";

import { photoHref } from "@/lib/photo-href";
import { catalogApiUrl, catalogPath } from "@/lib/catalog-api";
import { useCatalog } from "@/lib/catalog-context";
import { PhotoLibraryView } from "@/components/photo-library/photo-library-view";

export function LibraryView() {
  const { slug } = useCatalog();
  return (
    <PhotoLibraryView
      title="Library"
      calendar={{ facetsEndpoint: catalogApiUrl(slug, "/photos/calendar") }}
      collection={({ sort, month }) => ({
        endpoint: catalogApiUrl(slug, "/photos"),
        params: new URLSearchParams(month ? { sort, month } : { sort }),
        urlForId: (id) => photoHref(slug, id, undefined, sort),
        baseUrl: catalogPath(slug, "/photos"),
        key: `${sort}:${month ?? ""}`,
      })}
    />
  );
}
```

- [ ] **Step 2:** Typecheck + lint the file (empty / clean).
- [ ] **Step 3:** Commit:
```bash
git add "apps/web/src/app/(app)/c/[catalog]/photos/library-view.tsx"
git commit -m "refactor(web): library-view on PhotoLibraryView"
```

### Task 2.5: Migrate `album-view.tsx`

**Files:** Modify `apps/web/src/app/(app)/c/[catalog]/albums/[id]/album-view.tsx`

- [ ] **Step 1: READ the current file fully** to capture its exact props: the album title/subtitle, scope/endpoint+params (incl. month/calendar), `actionOptions` (`albumCover`, `excludeAlbumId`, `onTrashed`), smart-album read-only handling, and empty state.
- [ ] **Step 2: Replace its body** with `<PhotoLibraryView … />`, mapping: `title` = album name (+ its header extras if any must be preserved — if the album header has controls beyond the standard grid menus + calendar, STOP and report), `calendar` if the current view has `GridCalendarMenu`, `collection` = the album's current endpoint/params builder (keep month), `actionOptions={{ albumCover, excludeAlbumId, onTrashed }}`, `empty` = its current empty state. Preserve the album page's non-grid chrome (rename/cover/etc.) that lives OUTSIDE the grid view, if any, by leaving it in the page and only swapping the grid composition.
- [ ] **Step 3:** Typecheck + lint clean; **browser-confirm** the album page (grid, selection, set-cover, calendar, lightbox) behaves as before. Commit:
```bash
git add "apps/web/src/app/(app)/c/[catalog]/albums/[id]/album-view.tsx"
git commit -m "refactor(web): album-view on PhotoLibraryView"
```

### Task 2.6: Migrate `folder-photos-view.tsx` (album folder)

**Files:** Modify `apps/web/src/app/(app)/c/[catalog]/albums/folder/[id]/photos/folder-photos-view.tsx`

- [ ] **Step 1: Replace the body** with:

```tsx
// keep the "use client" + the component signature ({ folderId, folderName })
import { useRouter } from "next/navigation";
import { photoHref } from "@/lib/photo-href";
import { catalogApiUrl, catalogPath } from "@/lib/catalog-api";
import { useCatalog } from "@/lib/catalog-context";
import { PhotoLibraryView } from "@/components/photo-library/photo-library-view";

export function FolderPhotosView({ folderId, folderName }: { folderId: string; folderName: string }) {
  const router = useRouter();
  const { slug } = useCatalog();
  return (
    <PhotoLibraryView
      title={folderName}
      actionOptions={{ onTrashed: () => router.refresh() }}
      collection={({ sort }) => ({
        endpoint: catalogApiUrl(slug, `/folders/${folderId}/photos`),
        params: new URLSearchParams({ sort }),
        urlForId: (id) => photoHref(slug, id, undefined, sort),
        baseUrl: catalogPath(slug, `/albums/folder/${folderId}/photos`),
        key: `${folderId}:${sort}`,
      })}
    />
  );
}
```

(Confirm `baseUrl` matches the route this view lives on; adjust if different.)

- [ ] **Step 2:** Typecheck + lint clean. Commit:
```bash
git add "apps/web/src/app/(app)/c/[catalog]/albums/folder/[id]/photos/folder-photos-view.tsx"
git commit -m "refactor(web): album folder-photos-view on PhotoLibraryView"
```

### Task 2.7: Migrate `favorites-view.tsx`

**Files:** Modify `apps/web/src/app/(app)/c/[catalog]/favorites/favorites-view.tsx`

- [ ] **Step 1: Replace the body** (keep the existing `FAVORITES_EMPTY` Empty markup in the file and pass it as `empty`):

```tsx
"use client";
import { Heart } from "lucide-react";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { photoHref } from "@/lib/photo-href";
import { catalogApiUrl, catalogPath } from "@/lib/catalog-api";
import { useCatalog } from "@/lib/catalog-context";
import { PhotoLibraryView } from "@/components/photo-library/photo-library-view";

const FAVORITES_EMPTY = (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon"><Heart /></EmptyMedia>
      <EmptyTitle>No favorites yet</EmptyTitle>
      <EmptyDescription>Tap the heart on a photo to add it to your favorites.</EmptyDescription>
    </EmptyHeader>
  </Empty>
);

export function FavoritesView() {
  const { slug } = useCatalog();
  return (
    <PhotoLibraryView
      title="Favorites"
      empty={FAVORITES_EMPTY}
      actionOptions={{ dropOnUnfavorite: true }}
      collection={({ sort }) => ({
        endpoint: catalogApiUrl(slug, "/photos"),
        params: new URLSearchParams({ sort, favorite: "true" }),
        urlForId: (id) => photoHref(slug, id, undefined, sort),
        baseUrl: catalogPath(slug, "/favorites"),
        key: `fav:${sort}`,
      })}
    />
  );
}
```

(Confirm the current favorites endpoint/params shape — if it uses a different favorite param, match it.)

- [ ] **Step 2:** Typecheck + lint clean. Commit:
```bash
git add "apps/web/src/app/(app)/c/[catalog]/favorites/favorites-view.tsx"
git commit -m "refactor(web): favorites-view on PhotoLibraryView"
```

### Task 2.8: Verify Phase 2

- [ ] **Step 1:** `pnpm --filter @lumio/web test` → pass.
- [ ] **Step 2:** baseline-aware `tsc` empty; `eslint src` shows no NEW errors.
- [ ] **Step 3:** `pnpm --filter @lumio/web build` → success.
- [ ] **Step 4 (browser):** `/photos`, an album, an album folder, `/favorites` — each: grid renders, sort/size/view menus work, calendar works (photos/album), selection toolbar actions (favorite/label/add/download/trash) work, lightbox opens + context menu works.

---

## PHASE 3 — `/folders` page + scope simplify + cleanup

### Task 3.1: Simplify the folder scope (drop `fsort`)

**Files:** `lib/detail-scope.ts` (+test), `lib/photo-collection-scope.ts`, `lib/photo-order.ts`, `lib/photos-service.ts`, `lib/locate-photo.ts` (+test), `api/c/[catalog]/fs/photos/route.ts`

- [ ] **Step 1: `detail-scope.ts`** — folder variant → `{ kind:"folder"; dir: string; sort: PhotoSort }`. Remove `fsort` from the type, `RawSearchParams`, `parseDetailScope` (folder branch: `{ kind:"folder", dir: sp.folder, sort }`), and `detailScopeQuery` (folder branch: just `params.set("folder", scope.dir)`; the shared `if (scope.sort !== DEFAULT) set sort` already covers sort). Remove the `folderSortToParam`/`parseFolderSortParam` import.
- [ ] **Step 2: `detail-scope.test.ts`** — update the folder cases to expect `{ kind, dir, sort }` (no `fsort`); `detailScopeQuery({kind:"folder",dir:"a/b",sort:"imported-desc"})` → `"folder=a%2Fb"`.
- [ ] **Step 3: `photo-collection-scope.ts`** — folder branch params → `new URLSearchParams({ path: scope.dir, sort: scope.sort })`. Remove the `folderSortToParam` import.
- [ ] **Step 4: `photo-order.ts`** — delete `folderPhotoOrderBy` + the `FolderSort`/`Prisma` imports it needed.
- [ ] **Step 5: `photos-service.ts`** — revert `listPhotosForWhere` to `(catalogId, where, { limit, offset, sort })` using `photoOrderBy(sort)` (drop the `orderBy` param).
- [ ] **Step 6: `locate-photo.ts`** — remove the special folder branch + `folderPhotoOrderBy` import; in `scopeWhereFor`, folder → `{ dirPath: scope.dir }`. (Generic cursor path handles the index.) Update `locate-photo.test.ts`: drop the folder-`findMany` test; add `scopeWhereFor` folder → `{ dirPath }` (or a `locatePhoto` folder test using the existing fake `db` with `count`).
- [ ] **Step 7: `api/c/[catalog]/fs/photos/route.ts`** — read `sort = coercePhotoSort(searchParams.get("sort"))` (drop `fsort`); `listPhotosForWhere(catalog.id, { dirPath: dir }, { limit, offset, sort })`.
- [ ] **Step 8:** Typecheck empty; `pnpm --filter @lumio/web exec vitest run src/lib/detail-scope.test.ts src/lib/locate-photo.test.ts` pass. Commit:
```bash
git add apps/web/src/lib/detail-scope.ts apps/web/src/lib/detail-scope.test.ts apps/web/src/lib/photo-collection-scope.ts apps/web/src/lib/photo-order.ts apps/web/src/lib/photos-service.ts apps/web/src/lib/locate-photo.ts apps/web/src/lib/locate-photo.test.ts "apps/web/src/app/api/c/[catalog]/fs/photos/route.ts"
git commit -m "refactor(web): simplify folder scope to plain PhotoSort"
```

### Task 3.2: `listSubfolders` (replace `readCatalogDir`) + drop dead catalog-fs code + remove recursive search

**Files:** `lib/catalog-fs-service.ts` (+test), `lib/catalog-fs.ts` (+test), delete `api/c/[catalog]/fs/search/route.ts`

- [ ] **Step 1: Write the failing test** for `listSubfolders`:

```ts
// in apps/web/src/lib/catalog-fs-service.test.ts (replace the file's tests)
import { describe, expect, it } from "vitest";
import { listSubfolders, type SubfolderDeps } from "./catalog-fs-service.js";

function dirent(name: string, isDir: boolean) { return { name, isDirectory: () => isDir }; }
const catalog = { id: "cat1", path: "/media/fam" };

describe("listSubfolders", () => {
  it("returns sorted immediate subdirectories with their rel paths", async () => {
    const deps: SubfolderDeps = {
      readdir: async () => [dirent("b", true), dirent("a", true), dirent("x.jpg", false)],
    };
    expect(await listSubfolders(catalog, "2024", deps)).toEqual([
      { name: "a", rel: "2024/a" },
      { name: "b", rel: "2024/b" },
    ]);
  });
  it("blocks path traversal outside the catalog", async () => {
    const deps: SubfolderDeps = { readdir: async () => [] };
    await expect(listSubfolders(catalog, "../x", deps)).rejects.toThrow();
  });
});
```

- [ ] **Step 2:** Run it → fails (no `listSubfolders`).
- [ ] **Step 3: Implement** `listSubfolders` and remove `readCatalogDir`/`searchCatalogTree`/`CatalogSearchResult` from `catalog-fs-service.ts`:

```ts
// apps/web/src/lib/catalog-fs-service.ts
import { readdir } from "node:fs/promises";
import { originalPath } from "@/lib/paths";
import { joinRel } from "@/lib/catalog-fs";

export interface Subfolder { name: string; rel: string; }

export interface SubfolderDeps {
  readdir: (absPath: string) => Promise<{ name: string; isDirectory: () => boolean }[]>;
}

const defaultDeps: SubfolderDeps = {
  readdir: (absPath) => readdir(absPath, { withFileTypes: true }),
};

/** Immediate subdirectories of catalog-relative `rel` ("" = root), sorted by name.
 *  Bounded to the catalog dir via originalPath (throws on traversal). */
export async function listSubfolders(
  catalog: { id: string; path: string },
  rel: string,
  deps: SubfolderDeps = defaultDeps,
): Promise<Subfolder[]> {
  const absDir = originalPath(catalog, rel); // throws on traversal
  const entries = await deps.readdir(absDir);
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, rel: joinRel(rel, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
```

- [ ] **Step 4: `catalog-fs.ts`** — keep `joinRel`, `catalogBreadcrumbs` (+ `FsCrumb`). Delete `buildCatalogListing`, `folderCountLabel`, `sortFolderItems`, `FolderSort`/`FolderSortField`/`FolderSortDir`, `folderSortToParam`, `parseFolderSortParam`, and the `RawEntry`/`CatalogDirChild`/`CatalogFileChild`/`CatalogListing`/`DirChildCounts` types. Update `catalog-fs.test.ts` to test only `joinRel` + `catalogBreadcrumbs`.
- [ ] **Step 5:** `git rm "apps/web/src/app/api/c/[catalog]/fs/search/route.ts"`.
- [ ] **Step 6:** Run `pnpm --filter @lumio/web exec vitest run src/lib/catalog-fs.test.ts src/lib/catalog-fs-service.test.ts` → pass; typecheck → expect errors only in the old folder-explorer (fixed in 3.4). Commit:
```bash
git add -A && git commit -m "refactor(web): listSubfolders replaces readCatalogDir; drop recursive search"
```

### Task 3.3: Remove folder-prefs

**Files:** delete `lib/folder-prefs.ts` (+test), `lib/use-folder-prefs.ts`

- [ ] **Step 1:** `git rm apps/web/src/lib/folder-prefs.ts apps/web/src/lib/folder-prefs.test.ts apps/web/src/lib/use-folder-prefs.ts` (the new `folder-explorer` in 3.4 won't import them). Commit after 3.4 builds (these are referenced only by the current folder-explorer, replaced next).

### Task 3.4: Rebuild the `/folders` page (Folders + PhotoLibraryView)

**Files:**
- Create `app/(app)/c/[catalog]/folders/folder-breadcrumb.tsx`
- Create `app/(app)/c/[catalog]/folders/folders-section.tsx`
- Rewrite `app/(app)/c/[catalog]/folders/folder-explorer.tsx`
- Modify `app/(app)/c/[catalog]/folders/page.tsx`

- [ ] **Step 1: `folder-breadcrumb.tsx`** (mirrors the albums header trail):

```tsx
// apps/web/src/app/(app)/c/[catalog]/folders/folder-breadcrumb.tsx
import { Fragment } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { catalogBreadcrumbs } from "@/lib/catalog-fs";
import { catalogPath } from "@/lib/catalog-api";

function folderHref(slug: string, rel: string): string {
  const base = catalogPath(slug, "/folders");
  return rel ? `${base}?path=${encodeURIComponent(rel)}` : base;
}

/** "Library › 2024 › trip" trail for the folders header (matches /albums style). */
export function FolderBreadcrumb({ slug, rel }: { slug: string; rel: string }) {
  const crumbs = catalogBreadcrumbs(rel); // [{name:"Library",rel:""}, …]
  return (
    <span className="flex items-center gap-1">
      {crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <Fragment key={c.rel}>
            {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
            {isLast ? (
              <span className="truncate">{c.name}</span>
            ) : (
              <Link href={folderHref(slug, c.rel)} className="font-normal text-muted-foreground hover:text-foreground">
                {c.name}
              </Link>
            )}
          </Fragment>
        );
      })}
    </span>
  );
}
```

- [ ] **Step 2: `folders-section.tsx`**:

```tsx
// apps/web/src/app/(app)/c/[catalog]/folders/folders-section.tsx
import Link from "next/link";
import { Folder as FolderIcon } from "lucide-react";
import { catalogPath } from "@/lib/catalog-api";
import type { Subfolder } from "@/lib/catalog-fs-service";

function folderHref(slug: string, rel: string): string {
  return `${catalogPath(slug, "/folders")}?path=${encodeURIComponent(rel)}`;
}

/** Subfolder tiles above the photo grid; hidden when there are none. */
export function FoldersSection({ slug, dirs }: { slug: string; dirs: Subfolder[] }) {
  if (dirs.length === 0) return null;
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-xs font-medium text-muted-foreground">Folders</h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
        {dirs.map((d) => (
          <Link
            key={d.rel}
            href={folderHref(slug, d.rel)}
            className="flex flex-col items-center gap-2 rounded-lg border border-border p-4 text-center transition-colors hover:bg-muted"
          >
            <FolderIcon className="size-10 text-muted-foreground" aria-hidden />
            <span className="w-full truncate text-xs font-medium">{d.name}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: `folder-explorer.tsx`** (client; the `PhotoLibraryView` composition):

```tsx
// apps/web/src/app/(app)/c/[catalog]/folders/folder-explorer.tsx
"use client";

import { photoHref } from "@/lib/photo-href";
import { catalogApiUrl, catalogPath } from "@/lib/catalog-api";
import { useCatalog } from "@/lib/catalog-context";
import { PhotoLibraryView } from "@/components/photo-library/photo-library-view";
import type { Subfolder } from "@/lib/catalog-fs-service";
import { FolderBreadcrumb } from "./folder-breadcrumb";
import { FoldersSection } from "./folders-section";

export function FolderExplorer({ rel, subfolders }: { rel: string; subfolders: Subfolder[] }) {
  const { slug } = useCatalog();
  const folderQuery = (sort: string) =>
    new URLSearchParams(rel ? { folder: rel, sort } : { folder: "", sort });
  return (
    <PhotoLibraryView
      title={<FolderBreadcrumb slug={slug} rel={rel} />}
      aboveGrid={<FoldersSection slug={slug} dirs={subfolders} />}
      collection={({ sort }) => ({
        endpoint: catalogApiUrl(slug, "/fs/photos"),
        params: new URLSearchParams({ path: rel, sort }),
        // Detail href carries the folder scope so the lightbox strip stays in this folder.
        urlForId: (id) =>
          `${catalogPath(slug, `/photo/${id}`)}?${folderQuery(sort).toString()}`,
        baseUrl: rel
          ? `${catalogPath(slug, "/folders")}?path=${encodeURIComponent(rel)}`
          : catalogPath(slug, "/folders"),
        key: `folder:${rel}:${sort}`,
      })}
    />
  );
}
```

> Note: `urlForId` must produce the same query `detailScopeQuery({kind:"folder",dir:rel,sort})` would (i.e. `folder=<rel>` + `sort=` when non-default). Simplest: import `detailScopeQuery` from `@/lib/detail-scope` and use `detailScopeQuery({ kind: "folder", dir: rel, sort })` to build the query string — do that instead of hand-rolling `folderQuery` so they can't drift.

- [ ] **Step 4: `page.tsx`**:

```tsx
// apps/web/src/app/(app)/c/[catalog]/folders/page.tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isFeatureEnabled } from "@lumio/db";
import { FeatureKey } from "@lumio/shared";
import { getCatalogForSlug } from "@/lib/active-catalog";
import { listSubfolders } from "@/lib/catalog-fs-service";
import { FolderExplorer } from "./folder-explorer";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Folders" };

export default async function FoldersPage({
  params,
  searchParams,
}: {
  params: Promise<{ catalog: string }>;
  searchParams: Promise<{ path?: string | string[] }>;
}) {
  const { catalog: slug } = await params;
  const catalog = await getCatalogForSlug(slug);
  if (!(await isFeatureEnabled(catalog.id, FeatureKey.DiskExplorer))) notFound();

  const sp = await searchParams;
  const rel = typeof sp.path === "string" ? sp.path : "";

  let subfolders;
  try {
    subfolders = await listSubfolders(catalog, rel);
  } catch {
    notFound(); // traversal escape or missing directory
  }

  return (
    <main className="w-full px-4 pb-6">
      <FolderExplorer rel={rel} subfolders={subfolders} />
    </main>
  );
}
```

- [ ] **Step 5:** Use `detailScopeQuery` in `folder-explorer.tsx`'s `urlForId` (per the note). Typecheck empty; lint clean for the folders dir.
- [ ] **Step 6:** Commit (including the 3.3 deletions):
```bash
git add -A
git commit -m "feat(web): rebuild /folders on PhotoLibraryView (Folders + real photo grid)"
```

### Task 3.5: Full verification

- [ ] **Step 1:** `pnpm -r test` → all pass.
- [ ] **Step 2:** `pnpm -r typecheck 2>&1 | grep 'error TS' | grep -v calendar.ts` → empty.
- [ ] **Step 3:** `pnpm --filter @lumio/web exec eslint src` → no NEW errors (baseline files only).
- [ ] **Step 4:** `pnpm --filter @lumio/web build` → success.
- [ ] **Step 5 (browser):** `/folders` — subfolders show + navigate; breadcrumb works; the photo grid is the real grid (select, ⌘-click, double-click→lightbox with the strip staying in the folder, right-click context menu, bulk toolbar favorite/label/add/download/trash, sort/size/view menus); empty folder shows the empty state.

---

## Self-review notes (author)
- **Spec coverage:** Phase 1 = the mutation module + all six callers rerouted; Phase 2 = `PhotoLibraryView` + `SelectionActions` + moved `SelectionToolbar` + 4 migrations; Phase 3 = folder scope simplify + `listSubfolders` + removals + new folders page. Deviations from spec (calendar→`collection` builder; favorites stays endpoint-based, no new scope kind; unified clear-on-terminal-action) are documented at top.
- **Type consistency:** `PhotoCollectionSource` (endpoint/params/urlForId/baseUrl/key), `PhotoLibraryViewProps`, `Subfolder`/`SubfolderDeps`, the `photo-mutations` fn signatures, and the folder scope `{kind:"folder";dir;sort}` are used consistently across tasks.
- **Migration guard:** Tasks 2.5/2.6/2.7 say to READ each view first and STOP-and-report if it needs something `PhotoLibraryView` can't express (e.g., album-specific header chrome) rather than bending the component.
