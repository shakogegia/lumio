# Lightbox "Appears in" Album Membership — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the lightbox info-tab album checkbox list with an "Appears in" section that reuses the app's add-to-album UI: cover-thumbnail rows with hover-✕ removal, an "Add more" dropdown (the nested folder/album picker + "New album…"), and a loading skeleton.

**Architecture:** Rebuild the `AlbumMembership` component in `lightbox-sidebar.tsx` to read album metadata from the shared `useLibraryTree()` (the lightbox already sits inside `LibraryTreeProvider`) and route adds/creates through `useAddToAlbum()`. Membership still comes from `GET /api/photos/:id`; removes keep the existing `DELETE` + optimistic store patch. Two small supporting refactors: generalize the picker's single-id exclusion to a `Set`, and extract the shared cover-thumbnail markup.

**Tech Stack:** Next.js 16 (React, `"use client"`), TypeScript, Tailwind, shadcn-style `ui/*` components, vitest (node env), lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-06-21-lightbox-appears-in-design.md`

---

## File Structure

- **`apps/web/src/lib/library-tree-rows.ts`** — `buildAlbumTree` gains an optional `excludeAlbumIds: Set<string>` (Task 1).
- **`apps/web/src/lib/library-tree-rows.test.ts`** — new unit test for the set-exclusion (Task 1).
- **`apps/web/src/components/photo-actions/album-picker-items.tsx`** — extract a shared `AlbumThumb` (Task 2); thread `excludeAlbumIds` through `AlbumPickerItems` (Task 3).
- **`apps/web/src/components/photo-grid/lightbox-sidebar.tsx`** — drop the `/api/albums` fetch + visibility gate; rewrite `AlbumMembership` (Task 4).

Tasks 2 and 3 both touch `album-picker-items.tsx` but edit different, non-overlapping parts. Task 4 depends on Tasks 1–3.

---

### Task 1: Generalize `buildAlbumTree` to exclude a set of album ids

**Files:**
- Modify: `apps/web/src/lib/library-tree-rows.ts:32-39`
- Test: `apps/web/src/lib/library-tree-rows.test.ts`

- [ ] **Step 1: Write the failing test**

Add this `it(...)` block inside the existing `describe("buildAlbumTree", ...)` in `apps/web/src/lib/library-tree-rows.test.ts` (after the existing `excludes a given albumId` test, around line 47):

```ts
  it("excludes a set of albumIds, pruning a folder whose albums are all excluded", () => {
    const tree = buildAlbumTree(FOLDERS, ALBUMS, {
      excludeAlbumIds: new Set(["rome", "milan"]),
    });
    expect(tree.albums.map((a) => a.id)).toEqual(["top"]);
    expect(tree.folders).toEqual([]); // Italy emptied -> Europe pruned
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/web test library-tree-rows`
Expected: FAIL — the new test errors. Without the change, `excludeAlbumIds` is ignored, so Italy keeps `rome`+`milan` and `tree.folders` is `[europe]`, not `[]`. (TypeScript may also flag `excludeAlbumIds` as an unknown property — that's part of the failure.)

- [ ] **Step 3: Add `excludeAlbumIds` to the options and the filter**

In `apps/web/src/lib/library-tree-rows.ts`, replace the `buildAlbumTree` signature + the `pickable` filter (lines 32-39):

```ts
export function buildAlbumTree(
  folders: FolderDTO[],
  albums: AlbumSummaryDTO[],
  opts: {
    excludeAlbumId?: string;
    excludeAlbumIds?: Set<string>;
    includeSmart?: boolean;
    includeEmptyFolders?: boolean;
  } = {},
): { albums: AlbumSummaryDTO[]; folders: AlbumTreeNode[] } {
  const pickable = albums.filter(
    (a) =>
      (opts.includeSmart || !a.isSmart) &&
      a.id !== opts.excludeAlbumId &&
      !opts.excludeAlbumIds?.has(a.id),
  );
```

Also update the doc comment just above the function (line 30-31) to mention the set — change the clause "Smart albums and `excludeAlbumId` are filtered out" to "Smart albums, `excludeAlbumId`, and any id in `excludeAlbumIds` are filtered out".

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/web test library-tree-rows`
Expected: PASS — all `buildAlbumTree` and `buildFolderPickerRows` tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/library-tree-rows.ts apps/web/src/lib/library-tree-rows.test.ts
git commit -m "feat(web): buildAlbumTree can exclude a set of album ids

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Extract a shared `AlbumThumb` cover-thumbnail component

**Files:**
- Modify: `apps/web/src/components/photo-actions/album-picker-items.tsx:23-45`

This is a pure refactor — same rendered output, no behavior change. It's verified by lint + the later browser check, not a unit test (component, node-env vitest has no DOM).

- [ ] **Step 1: Add the `AlbumThumb` component and use it inside `AlbumOption`**

In `apps/web/src/components/photo-actions/album-picker-items.tsx`, replace the entire `AlbumOption` function (lines 23-45) with the following — it adds an exported `AlbumThumb` and has `AlbumOption` consume it:

```tsx
/** The square album cover thumbnail (or a fallback icon), shared by the picker
 *  rows and the lightbox "Appears in" list. */
export function AlbumThumb({ coverPhotoId }: { coverPhotoId: string | null }) {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
      {coverPhotoId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/thumbnails/${coverPhotoId}`}
          alt=""
          className="h-full w-full object-cover"
        />
      ) : (
        <Images className="size-3.5 text-muted-foreground" />
      )}
    </span>
  );
}

function AlbumOption({
  album,
  Item,
  onPick,
}: {
  album: AlbumSummaryDTO;
  Item: ItemComponent;
  onPick: (albumId: string) => void;
}) {
  return (
    <Item onSelect={() => onPick(album.id)}>
      <AlbumThumb coverPhotoId={album.coverPhotoId} />
      <span className="truncate">{album.name}</span>
    </Item>
  );
}
```

(`Images` is already imported on line 3; leave the import as-is.)

- [ ] **Step 2: Lint to verify no regressions**

Run: `pnpm --filter @lumio/web lint`
Expected: PASS (no new errors/warnings for `album-picker-items.tsx`).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/photo-actions/album-picker-items.tsx
git commit -m "refactor(web): extract shared AlbumThumb from AlbumOption

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Thread `excludeAlbumIds` through `AlbumPickerItems`

**Files:**
- Modify: `apps/web/src/components/photo-actions/album-picker-items.tsx:80-92`

- [ ] **Step 1: Add the prop and pass it to `buildAlbumTree`**

In `apps/web/src/components/photo-actions/album-picker-items.tsx`, replace the `AlbumPickerItems` function header through the `buildAlbumTree` call (lines 80-92) with:

```tsx
export function AlbumPickerItems({
  menu,
  excludeAlbumId,
  excludeAlbumIds,
  onPick,
  onCreateNew,
}: {
  menu: AlbumPickerMenu;
  excludeAlbumId?: string;
  excludeAlbumIds?: Set<string>;
  onPick: (albumId: string) => void;
  onCreateNew: () => void;
}) {
  const { folders, albums, loading, error } = useLibraryTree();
  const tree = buildAlbumTree(folders, albums, { excludeAlbumId, excludeAlbumIds });
```

(Leave the rest of the function — `status` computation and the returned JSX — unchanged.)

- [ ] **Step 2: Lint to verify the new prop type-checks**

Run: `pnpm --filter @lumio/web lint`
Expected: PASS. Existing callers (`add-to-album-menu.tsx`, `photo-context-menu.tsx`) pass only `excludeAlbumId` and remain valid since `excludeAlbumIds` is optional.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/photo-actions/album-picker-items.tsx
git commit -m "feat(web): AlbumPickerItems accepts an excludeAlbumIds set

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Rebuild the lightbox `AlbumMembership` as "Appears in"

**Files:**
- Modify: `apps/web/src/components/photo-grid/lightbox-sidebar.tsx` (imports lines 1-13; `LightboxSidebar` body lines 21-73; `AlbumMembership` lines 89-174)

No unit test (React component, node-env vitest has no DOM). Verified by lint + the browser checklist in Task 5.

- [ ] **Step 1: Replace the import block**

Replace lines 1-13 of `apps/web/src/components/photo-grid/lightbox-sidebar.tsx` with:

```tsx
"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Plus, Search, X } from "lucide-react";
import type { AlbumSummaryDTO, PhotoDTO } from "@lumio/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { exifEntries, filterExifEntries } from "@/lib/exif-entries";
import { useLibraryTree } from "@/components/library-tree/library-tree";
import {
  AlbumPickerItems,
  AlbumThumb,
} from "@/components/photo-actions/album-picker-items";
import { useAddToAlbum } from "@/components/photo-actions/use-add-to-album";
import { usePhotoCollection } from "./photo-collection";
import { LightboxEditPanel } from "./lightbox-edit-panel";
```

- [ ] **Step 2: Remove the parent's `/api/albums` fetch**

In `LightboxSidebar`, delete the album-catalog state + effect (current lines 21-37 — the comment `// The store's grid photo carries no album list...` through the `}, []);` closing the `useEffect`). After deletion, the function goes straight from `const metadata = exifEntries(photo.exif);` to `return (`.

- [ ] **Step 3: Always render the membership section**

In `LightboxSidebar`'s returned JSX, replace the conditional block (current lines 60-73, the `{regularAlbums.length > 0 && ( ... )}` expression) with:

```tsx
            <Separator />
            {/* Keyed on photo.id so membership re-initializes per photo during
              arrow-key navigation. */}
            <AlbumMembership key={photo.id} photo={photo} />
```

- [ ] **Step 4: Replace the `AlbumMembership` component**

Replace the entire old `AlbumMembership` function (current lines 89-174) with:

```tsx
function AlbumMembership({ photo }: { photo: PhotoDTO }) {
  const { patchPhotos } = usePhotoCollection();
  const { albums, loading: treeLoading } = useLibraryTree();
  const { addToAlbum, addToAlbumDirect, element } = useAddToAlbum();
  const [pending, setPending] = useState(false);
  // Null until the photo's full DTO loads (the grid photo carries no albumIds).
  const [albumIds, setAlbumIds] = useState<string[] | null>(
    photo.albumIds ?? null,
  );

  // Learn this photo's current membership.
  useEffect(() => {
    let alive = true;
    fetch(`/api/photos/${photo.id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((data: PhotoDTO) => {
        if (alive) setAlbumIds(data.albumIds ?? []);
      })
      .catch(() => {
        /* leave membership unknown on failure */
      });
    return () => {
      alive = false;
    };
  }, [photo.id]);

  // Re-read membership from the server and sync the grid store. Used after the
  // "New album…" dialog adds the photo (the dialog doesn't return the new id).
  const resync = useCallback(() => {
    fetch(`/api/photos/${photo.id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((data: PhotoDTO) => {
        const next = data.albumIds ?? [];
        setAlbumIds(next);
        patchPhotos(new Set([photo.id]), { albumIds: next });
      })
      .catch(() => {
        /* leave membership as-is on failure */
      });
  }, [photo.id, patchPhotos]);

  // Add to an existing album via the shared quick-pick (POST + sound + refresh),
  // then optimistically reflect it locally and in the grid store.
  function add(albumId: string) {
    const next = [...(albumIds ?? []), albumId];
    void addToAlbumDirect([photo.id], albumId, {
      onSuccess: () => {
        setAlbumIds(next);
        patchPhotos(new Set([photo.id]), { albumIds: next });
      },
    });
  }

  async function remove(albumId: string) {
    if (pending) return;
    const next = (albumIds ?? []).filter((id) => id !== albumId);
    setPending(true);
    try {
      const res = await fetch(`/api/albums/${albumId}/photos/${photo.id}`, {
        method: "DELETE",
      });
      // Only commit once the server confirms, so a failed delete can't leave
      // phantom membership in the UI or the shared grid store.
      if (!res.ok) {
        toast.error("Failed to update album.");
        return;
      }
      setAlbumIds(next);
      patchPhotos(new Set([photo.id]), { albumIds: next });
    } finally {
      setPending(false);
    }
  }

  const byId = new Map(albums.map((a) => [a.id, a]));
  const memberAlbums = (albumIds ?? [])
    .map((id) => byId.get(id))
    .filter((a): a is AlbumSummaryDTO => a !== undefined && !a.isSmart)
    .sort((a, b) => a.name.localeCompare(b.name));
  // Skeleton until we know membership AND have the album list to resolve names.
  const loading = albumIds === null || (treeLoading && albums.length === 0);

  return (
    <div>
      <p className="mb-2 font-medium">Appears in</p>
      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-2">
              <Skeleton className="size-6 rounded-md" />
              <Skeleton className="h-4 w-32 rounded" />
            </div>
          ))}
        </div>
      ) : memberAlbums.length === 0 ? (
        <p className="text-muted-foreground">Not in any album yet</p>
      ) : (
        <div className="space-y-0.5">
          {memberAlbums.map((album) => (
            <div
              key={album.id}
              className="group/row flex items-center gap-2 rounded-md"
            >
              <AlbumThumb coverPhotoId={album.coverPhotoId} />
              <span className="truncate">{album.name}</span>
              <button
                type="button"
                onClick={() => void remove(album.id)}
                aria-label={`Remove from ${album.name}`}
                className="ml-auto rounded p-1 text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={albumIds === null}
            className="mt-2 w-full"
          >
            <Plus aria-hidden />
            Add more
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <AlbumPickerItems
            menu={{
              Item: DropdownMenuItem,
              Separator: DropdownMenuSeparator,
              Sub: DropdownMenuSub,
              SubTrigger: DropdownMenuSubTrigger,
              SubContent: DropdownMenuSubContent,
            }}
            excludeAlbumIds={new Set(albumIds ?? [])}
            onPick={(albumId) => add(albumId)}
            onCreateNew={() => addToAlbum([photo.id], { onSuccess: resync })}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      {element}
    </div>
  );
}
```

- [ ] **Step 5: Lint to verify the rewrite type-checks and is React-Compiler-clean**

Run: `pnpm --filter @lumio/web lint`
Expected: PASS. Watch specifically for: no unused imports (`Badge`, `Separator`, `Input`, `Search`, `AlbumSummaryDTO` are all still used), `"use client"` still on line 1, and no React-Compiler warnings about mutating props/state (the `.sort()` is on the freshly `.map().filter()`-ed array, not on state).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/photo-grid/lightbox-sidebar.tsx
git commit -m "feat(web): lightbox 'Appears in' album list with add-to-album UI

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the web unit tests and lint together**

Run: `pnpm --filter @lumio/web test && pnpm --filter @lumio/web lint`
Expected: all tests PASS, lint clean.

- [ ] **Step 2: Start the dev server**

Run: `pnpm dev` (serves on the configured port — open the photos page and a photo).

- [ ] **Step 3: Browser checklist (lightbox info tab)**

Open a photo to launch the lightbox, ensure the **Info** tab is active, and confirm each:

- [ ] Heading reads **"Appears in"** (not "Albums"), with no checkboxes anywhere.
- [ ] A `Skeleton` row group briefly shows before membership loads (throttle network if needed to observe it).
- [ ] Albums the photo is in render as rows: cover thumbnail (or `Images` fallback) + name.
- [ ] Hovering a row reveals the ✕; clicking it removes the photo from that album, the row disappears, and the grid's album badge/count updates.
- [ ] A photo in no albums shows "Not in any album yet" plus the Add more button.
- [ ] **Add more** opens the nested folder/album picker; albums the photo is already in are **absent** from the menu; folders nest as in the toolbar menu.
- [ ] Picking an album adds the photo (ActionComplete sound plays), the row appears in "Appears in", and that album no longer shows in a re-opened Add more menu.
- [ ] **New album…** opens the create dialog; after creating, the photo is added and the new album appears in "Appears in".
- [ ] Arrow-key navigation to the next/previous photo re-loads that photo's membership correctly (no carry-over from the previous photo).

- [ ] **Step 4: Note any failures**

If any checklist item fails, capture the symptom and fix before considering the task complete. Do not claim completion until every box is checked.

---

## Self-Review Notes

- **Spec coverage:** "Appears in" heading + rows (Task 4), hover-✕ removal (Task 4), Add more → `AlbumPickerItems` with already-joined hidden (Tasks 1, 3, 4), Skeleton (Task 4), reuse `useLibraryTree` + `useAddToAlbum` (Task 4), `excludeAlbumIds` generalization (Tasks 1, 3), `AlbumThumb` extraction (Task 2), always-show section (Task 4, Step 3), drop `/api/albums` fetch (Task 4, Step 2). All covered.
- **Type consistency:** `AlbumThumb({ coverPhotoId: string | null })` defined in Task 2, consumed in Task 4. `excludeAlbumIds?: Set<string>` defined on `buildAlbumTree` (Task 1) and `AlbumPickerItems` (Task 3), passed in Task 4. `useAddToAlbum()` returns `{ addToAlbum, addToAlbumDirect, element }`; `addToAlbumDirect(ids, albumId, { onSuccess })` and `addToAlbum(ids, { onSuccess })` signatures match `use-add-to-album.tsx`.
- **Known limitation:** if `/api/library/tree` fails to load entirely, a photo's existing albums can't be resolved to names and the list falls back to the empty state (the Add more picker shows "Failed to load albums."). Acceptable for this scope.
