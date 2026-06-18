# Photos Select Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a multi-select mode to the photo grid on `/photos` ("Library") and `/albums/[id]`, letting the user select photos (tap + shift-range) and bulk-add them to an album (existing or new-from-selection), plus bulk-remove from the current album.

**Architecture:** Reusable mechanics — a pure `computeSelection` helper, a `useGridSelection` hook, select-mode props on the shared `PhotoGrid`, a `SelectionToolbar`, and a reusable `AddToAlbumDialog` — are composed by two thin per-page client views (`LibraryView`, `AlbumView`) that differ only in their toolbar actions. The backend gains batch add/remove endpoints sharing one `photoIds` zod schema.

**Tech Stack:** Next.js (App Router, `--webpack`), React client components, TanStack virtual, Zod (`@lumio/shared`), Prisma (`@lumio/db`), Vitest, Tailwind + shadcn UI.

**Spec:** `docs/superpowers/specs/2026-06-18-photos-select-mode-design.md`

**Test commands (reference):**
- Shared package: `pnpm --filter @lumio/shared test`
- Web package (all): `pnpm --filter @lumio/web test`
- Web single file: `pnpm --filter @lumio/web exec vitest run <path>`
- Web lint: `pnpm --filter @lumio/web lint`

**Green-between-tasks note:** Tasks 1–2 *add* batch schema/service alongside the existing single-photo ones, so every commit compiles. Task 3 switches the routes to batch and removes the now-dead single-photo schema + service function together. Do not remove the single-photo pieces before Task 3.

---

## File Structure

**Backend / shared (Tasks 1–3):**
- Modify `packages/shared/src/albums.ts` — add `albumPhotosSchema` (Task 1); remove `addPhotoSchema` (Task 3).
- Modify `packages/shared/src/albums.test.ts` — schema tests (Task 1).
- Modify `apps/web/src/lib/albums-service.ts` — add `addPhotosToAlbum` + `removePhotosFromAlbum` (Task 2); remove `addPhotoToAlbum` (Task 3).
- Modify `apps/web/src/lib/albums-service.test.ts` — batch service tests (Task 2); drop `addPhotoToAlbum` test (Task 3).
- Modify `apps/web/src/app/api/albums/[id]/photos/route.ts` — POST→batch + new DELETE (Task 3).

**Client mechanics (Tasks 4–7):**
- Create `apps/web/src/lib/grid-selection.ts` + `.test.ts` — pure `computeSelection` (Task 4).
- Create `apps/web/src/lib/use-grid-selection.ts` — `useGridSelection` hook (Task 5).
- Create `apps/web/src/app/(app)/photos/selection-toolbar.tsx` — `SelectionToolbar` (Task 6).
- Modify `apps/web/src/app/(app)/photos/photo-grid.tsx` — select-mode props + tile rendering (Task 7).

**Client features + wiring (Tasks 8–10):**
- Create `apps/web/src/app/(app)/photos/add-to-album-dialog.tsx` — `AddToAlbumDialog` (Task 8).
- Create `apps/web/src/app/(app)/photos/library-view.tsx` + modify `.../photos/page.tsx` (Task 9).
- Create `apps/web/src/app/(app)/albums/[id]/album-view.tsx` + modify `.../albums/[id]/page.tsx` (Task 10).

**Verification (Task 11):** manual browser checklist.

---

## Task 1: Batch `photoIds` schema (shared)

**Files:**
- Modify: `packages/shared/src/albums.ts`
- Test: `packages/shared/src/albums.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/albums.test.ts`. Also add `albumPhotosSchema` to the import on line 2 (`import { albumPhotosSchema, createAlbumSchema, smartRulesSchema } from "./albums.js";`).

```typescript
describe("albumPhotosSchema", () => {
  it("accepts a non-empty photoIds array", () => {
    const result = albumPhotosSchema.parse({ photoIds: ["p1", "p2"] });
    expect(result.photoIds).toEqual(["p1", "p2"]);
  });

  it("rejects an empty photoIds array", () => {
    expect(() => albumPhotosSchema.parse({ photoIds: [] })).toThrow();
  });

  it("rejects a photoIds entry that is an empty string", () => {
    expect(() => albumPhotosSchema.parse({ photoIds: [""] })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/shared test`
Expected: FAIL — `albumPhotosSchema` is not exported (import error / undefined).

- [ ] **Step 3: Add the schema**

In `packages/shared/src/albums.ts`, below the existing `addPhotoSchema` line (line 31), add:

```typescript
export const albumPhotosSchema = z.object({
  photoIds: z.array(z.string().min(1)).min(1),
});
export type AlbumPhotosInput = z.infer<typeof albumPhotosSchema>;
```

(Leave `addPhotoSchema` in place — Task 3 removes it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/shared test`
Expected: PASS (all `albums.test.ts` describes green).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/albums.ts packages/shared/src/albums.test.ts
git commit -m "feat(shared): add albumPhotosSchema for batch album photo ops"
```

---

## Task 2: Batch service functions

**Files:**
- Modify: `apps/web/src/lib/albums-service.ts`
- Test: `apps/web/src/lib/albums-service.test.ts`

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/lib/albums-service.test.ts`, add `addPhotosToAlbum` and `removePhotosFromAlbum` to the import block (lines 2–7), then append:

```typescript
describe("addPhotosToAlbum", () => {
  it("throws SmartAlbumMutationError for smart albums", async () => {
    const fakeDb = {
      album: { findUnique: async () => ({ isSmart: true }) },
      albumPhoto: {},
      photo: {},
    };
    await expect(
      addPhotosToAlbum("alb1", ["p1"], fakeDb as never),
    ).rejects.toBeInstanceOf(SmartAlbumMutationError);
  });

  it("createMany with skipDuplicates and returns the inserted count", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const fakeDb = {
      album: { findUnique: async () => ({ isSmart: false }) },
      albumPhoto: { createMany },
      photo: {},
    };
    const count = await addPhotosToAlbum("alb1", ["p1", "p2"], fakeDb as never);
    expect(count).toBe(2);
    expect(createMany).toHaveBeenCalledWith({
      data: [
        { albumId: "alb1", photoId: "p1" },
        { albumId: "alb1", photoId: "p2" },
      ],
      skipDuplicates: true,
    });
  });
});

describe("removePhotosFromAlbum", () => {
  it("throws SmartAlbumMutationError for smart albums", async () => {
    const fakeDb = {
      album: { findUnique: async () => ({ isSmart: true }) },
      albumPhoto: {},
      photo: {},
    };
    await expect(
      removePhotosFromAlbum("alb1", ["p1"], fakeDb as never),
    ).rejects.toBeInstanceOf(SmartAlbumMutationError);
  });

  it("deleteMany on the given ids and returns the removed count", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const fakeDb = {
      album: { findUnique: async () => ({ isSmart: false }) },
      albumPhoto: { deleteMany },
      photo: {},
    };
    const count = await removePhotosFromAlbum("alb1", ["p1", "p2"], fakeDb as never);
    expect(count).toBe(2);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { albumId: "alb1", photoId: { in: ["p1", "p2"] } },
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/albums-service.test.ts`
Expected: FAIL — `addPhotosToAlbum` / `removePhotosFromAlbum` not exported.

- [ ] **Step 3: Implement the batch functions**

In `apps/web/src/lib/albums-service.ts`, after `removePhotoFromAlbum` (end of file, currently line 103), add:

```typescript
export async function addPhotosToAlbum(
  albumId: string,
  photoIds: string[],
  db: Db = prisma,
): Promise<number> {
  const album = await db.album.findUnique({ where: { id: albumId }, select: { isSmart: true } });
  if (!album) throw new AlbumNotFoundError();
  if (album.isSmart) throw new SmartAlbumMutationError("cannot add photos to a smart album");
  const result = await db.albumPhoto.createMany({
    data: photoIds.map((photoId) => ({ albumId, photoId })),
    skipDuplicates: true,
  });
  return result.count;
}

export async function removePhotosFromAlbum(
  albumId: string,
  photoIds: string[],
  db: Db = prisma,
): Promise<number> {
  const album = await db.album.findUnique({ where: { id: albumId }, select: { isSmart: true } });
  if (!album) throw new AlbumNotFoundError();
  if (album.isSmart) throw new SmartAlbumMutationError("cannot remove photos from a smart album");
  const result = await db.albumPhoto.deleteMany({
    where: { albumId, photoId: { in: photoIds } },
  });
  return result.count;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/albums-service.test.ts`
Expected: PASS (existing + new describes green).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/albums-service.ts apps/web/src/lib/albums-service.test.ts
git commit -m "feat(web): batch addPhotosToAlbum/removePhotosFromAlbum services"
```

---

## Task 3: Switch routes to batch; remove dead single-photo pieces

**Files:**
- Modify: `apps/web/src/app/api/albums/[id]/photos/route.ts`
- Modify: `packages/shared/src/albums.ts` (remove `addPhotoSchema`)
- Modify: `apps/web/src/lib/albums-service.ts` (remove `addPhotoToAlbum`)
- Modify: `apps/web/src/lib/albums-service.test.ts` (drop `addPhotoToAlbum` describe)

- [ ] **Step 1: Rewrite the route file**

Replace the entire contents of `apps/web/src/app/api/albums/[id]/photos/route.ts` with:

```typescript
import { NextResponse } from "next/server";
import { albumPhotosSchema, photosQuerySchema } from "@lumio/shared";
import {
  addPhotosToAlbum,
  AlbumNotFoundError,
  listAlbumPhotos,
  removePhotosFromAlbum,
  SmartAlbumMutationError,
} from "@/lib/albums-service";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(
  async (request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const parsed = photosQuerySchema.safeParse(Object.fromEntries(searchParams));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const page = await listAlbumPhotos(id, parsed.data);
    if (!page) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }
    return NextResponse.json(page);
  },
);

export const POST = withAuth(
  async (request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const body: unknown = await request.json();
    const parsed = albumPhotosSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    try {
      const count = await addPhotosToAlbum(id, parsed.data.photoIds);
      return NextResponse.json({ status: "added", count }, { status: 201 });
    } catch (err) {
      if (err instanceof SmartAlbumMutationError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      if (err instanceof AlbumNotFoundError) {
        return NextResponse.json({ error: "Album not found" }, { status: 404 });
      }
      throw err;
    }
  },
);

export const DELETE = withAuth(
  async (request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const body: unknown = await request.json();
    const parsed = albumPhotosSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    try {
      const count = await removePhotosFromAlbum(id, parsed.data.photoIds);
      return NextResponse.json({ status: "removed", count });
    } catch (err) {
      if (err instanceof SmartAlbumMutationError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      if (err instanceof AlbumNotFoundError) {
        return NextResponse.json({ error: "Album not found" }, { status: 404 });
      }
      throw err;
    }
  },
);
```

- [ ] **Step 2: Remove the dead single-photo schema**

In `packages/shared/src/albums.ts`, delete the line:

```typescript
export const addPhotoSchema = z.object({ photoId: z.string().min(1) });
```

- [ ] **Step 3: Remove the dead single-photo service + its test**

In `apps/web/src/lib/albums-service.ts`, delete the entire `addPhotoToAlbum` function (currently lines 90–99). Keep `removePhotoFromAlbum` (still used by the single-photo DELETE route at `.../photos/[photoId]/route.ts`).

In `apps/web/src/lib/albums-service.test.ts`, delete the whole `describe("addPhotoToAlbum", ...)` block and remove `addPhotoToAlbum` from the import on line 2.

- [ ] **Step 4: Verify schema + service tests pass and lint is clean**

Run: `pnpm --filter @lumio/shared test`
Expected: PASS.

Run: `pnpm --filter @lumio/web exec vitest run src/lib/albums-service.test.ts`
Expected: PASS (no `addPhotoToAlbum` references remain).

Run: `pnpm --filter @lumio/web lint`
Expected: no errors (no unused `addPhotoSchema` / `addPhotoToAlbum` imports anywhere).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/albums/[id]/photos/route.ts packages/shared/src/albums.ts apps/web/src/lib/albums-service.ts apps/web/src/lib/albums-service.test.ts
git commit -m "feat(web): batch add/remove album-photo routes; drop single-photo POST contract"
```

---

## Task 4: `computeSelection` pure helper

**Files:**
- Create: `apps/web/src/lib/grid-selection.ts`
- Test: `apps/web/src/lib/grid-selection.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/grid-selection.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { computeSelection } from "./grid-selection.js";

const IDS = ["a", "b", "c", "d", "e"];

describe("computeSelection", () => {
  it("adds an unselected photo on a plain click", () => {
    const next = computeSelection(new Set(), IDS, 2, false, null);
    expect([...next]).toEqual(["c"]);
  });

  it("removes a selected photo on a plain click (toggle off)", () => {
    const next = computeSelection(new Set(["c"]), IDS, 2, false, null);
    expect([...next]).toEqual([]);
  });

  it("selects the inclusive range from anchor to index on shift-click", () => {
    const next = computeSelection(new Set(["a"]), IDS, 3, true, 1);
    expect([...next].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("handles a shift range that runs backwards (index before anchor)", () => {
    const next = computeSelection(new Set(), IDS, 1, true, 3);
    expect([...next].sort()).toEqual(["b", "c", "d"]);
  });

  it("falls back to a single toggle when shift is held but anchor is null", () => {
    const next = computeSelection(new Set(), IDS, 2, true, null);
    expect([...next]).toEqual(["c"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/grid-selection.test.ts`
Expected: FAIL — `computeSelection` not found.

- [ ] **Step 3: Implement the helper**

Create `apps/web/src/lib/grid-selection.ts`:

```typescript
/**
 * Pure selection reducer for the photo grid. Given the current selected set and
 * a click at `index` (with the ordered photo id list), returns the next set.
 * - Plain click: toggle the single photo at `index`.
 * - Shift-click with a valid `anchorIndex`: additively select the inclusive
 *   range between the anchor and the clicked index (either direction).
 * - Shift-click with no anchor: behaves like a plain toggle.
 */
export function computeSelection(
  current: Set<string>,
  photoIds: string[],
  index: number,
  shiftKey: boolean,
  anchorIndex: number | null,
): Set<string> {
  const next = new Set(current);

  if (shiftKey && anchorIndex !== null) {
    const lo = Math.min(anchorIndex, index);
    const hi = Math.max(anchorIndex, index);
    for (let i = lo; i <= hi; i++) {
      const id = photoIds[i];
      if (id) next.add(id);
    }
    return next;
  }

  const id = photoIds[index];
  if (!id) return next;
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/grid-selection.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/grid-selection.ts apps/web/src/lib/grid-selection.test.ts
git commit -m "feat(web): computeSelection helper for grid multi-select"
```

---

## Task 5: `useGridSelection` hook

**Files:**
- Create: `apps/web/src/lib/use-grid-selection.ts`

This is trivial state glue (no DOM/React test infra in this repo — verified by typecheck/lint and later browser checks).

- [ ] **Step 1: Create the hook**

Create `apps/web/src/lib/use-grid-selection.ts`:

```typescript
import { useCallback, useState } from "react";

/** Owns select-mode toggle + the selected photo-id set. Page-agnostic. */
export function useGridSelection() {
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const enter = useCallback(() => setSelectMode(true), []);
  const clear = useCallback(() => setSelected(new Set()), []);
  const cancel = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
  }, []);

  return {
    selectMode,
    selected,
    setSelected,
    enter,
    cancel,
    clear,
    count: selected.size,
  };
}
```

- [ ] **Step 2: Verify it lints**

Run: `pnpm --filter @lumio/web lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/use-grid-selection.ts
git commit -m "feat(web): useGridSelection hook for grid select state"
```

---

## Task 6: `SelectionToolbar` component

**Files:**
- Create: `apps/web/src/app/(app)/photos/selection-toolbar.tsx`

Renders only the *select-mode* header: a count/title on the left, `Cancel` + an `actions` slot on the right. Matches the albums-header layout (`mb-6 flex items-center justify-between`).

- [ ] **Step 1: Create the component**

Create `apps/web/src/app/(app)/photos/selection-toolbar.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";

export function SelectionToolbar({
  title,
  count,
  onCancel,
  actions,
}: {
  /** Shown on the left when nothing is selected yet. */
  title: string;
  count: number;
  onCancel: () => void;
  /** Page-specific action buttons (e.g. Add to album, Remove from album). */
  actions: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex items-center justify-between gap-4">
      <h1 className="text-2xl font-semibold">
        {count > 0 ? `${count} selected` : title}
      </h1>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        {actions}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it lints**

Run: `pnpm --filter @lumio/web lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(app)/photos/selection-toolbar.tsx"
git commit -m "feat(web): SelectionToolbar for grid select mode"
```

---

## Task 7: `PhotoGrid` select-mode props + tile rendering

**Files:**
- Modify: `apps/web/src/app/(app)/photos/photo-grid.tsx`

Add optional `selectMode` / `selectedIds` / `onSelectionChange` props. When `selectMode` is on, tiles render as `<button>`s (toggle/shift-range) with a check overlay instead of `<Link>`s. Default (album detail page today) is unchanged.

- [ ] **Step 1: Update imports**

In `apps/web/src/app/(app)/photos/photo-grid.tsx`:

- Change the lucide import (line 6) to add the two circle icons:
  ```tsx
  import { CheckCircle2, Circle, Images } from "lucide-react";
  ```
- Add two imports below the existing `@/lib/grid-layout` import (line 8):
  ```tsx
  import { computeSelection } from "@/lib/grid-selection";
  import { cn } from "@/lib/utils";
  ```

- [ ] **Step 2: Extend the component signature**

Replace the `PhotoGrid({ ... }: { ... })` signature (lines 47–53) with:

```tsx
export function PhotoGrid({
  endpoint = "/api/photos",
  empty = PHOTOS_EMPTY,
  selectMode = false,
  selectedIds,
  onSelectionChange,
}: {
  endpoint?: string;
  empty?: React.ReactNode;
  selectMode?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
}) {
```

- [ ] **Step 3: Add the anchor ref + click handler**

Immediately after `const loadingRef = useRef(false);` (line 58), add:

```tsx
  // Index of the last plain-clicked tile, used as the shift-range anchor.
  const anchorRef = useRef<number | null>(null);

  function handleTileClick(index: number, e: React.MouseEvent) {
    if (!onSelectionChange) return;
    const next = computeSelection(
      selectedIds ?? new Set<string>(),
      photos.map((p) => p.id),
      index,
      e.shiftKey,
      anchorRef.current,
    );
    if (!e.shiftKey) anchorRef.current = index;
    onSelectionChange(next);
  }
```

- [ ] **Step 4: Render tiles as buttons in select mode**

Replace the inner `rowPhotos.map(...)` block (lines 175–191, the `<Link>…</Link>` mapping) with:

```tsx
              {rowPhotos.map((photo, i) => {
                const globalIndex = start + i;
                const thumb = (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/thumbnails/${photo.id}`}
                    alt={photo.path}
                    loading="lazy"
                    width={photo.width}
                    height={photo.height}
                    className="h-full w-full object-cover transition-opacity hover:opacity-90"
                  />
                );

                if (selectMode) {
                  const isSelected = selectedIds?.has(photo.id) ?? false;
                  return (
                    <button
                      key={photo.id}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={(e) => handleTileClick(globalIndex, e)}
                      className={cn(
                        "relative block h-full select-none bg-skeleton outline-none focus:outline-none focus-visible:outline-none",
                        isSelected && "ring-2 ring-inset ring-primary",
                      )}
                    >
                      <div className={cn("h-full w-full transition-transform", isSelected && "scale-[0.92]")}>
                        {thumb}
                      </div>
                      <span className="absolute left-2 top-2 rounded-full bg-background/70 text-foreground">
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
                    key={photo.id}
                    href={`/photo/${photo.id}`}
                    className="block h-full bg-skeleton outline-none focus:outline-none focus-visible:outline-none"
                  >
                    {thumb}
                  </Link>
                );
              })}
```

- [ ] **Step 5: Verify lint + existing tests still pass**

Run: `pnpm --filter @lumio/web lint`
Expected: no errors.

Run: `pnpm --filter @lumio/web test`
Expected: PASS (grid-layout, grid-selection, albums-service, photos-service all green).

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(app)/photos/photo-grid.tsx"
git commit -m "feat(web): PhotoGrid select mode (toggle + shift-range tiles)"
```

---

## Task 8: `AddToAlbumDialog` component

**Files:**
- Create: `apps/web/src/app/(app)/photos/add-to-album-dialog.tsx`

Controlled dialog: fetches `GET /api/albums` on open, filters to manual albums (excluding `excludeAlbumId`), offers "new album from selection" + the existing-album list, and posts `{ photoIds }`.

- [ ] **Step 1: Create the component**

Create `apps/web/src/app/(app)/photos/add-to-album-dialog.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Images } from "lucide-react";
import type { AlbumSummaryDTO } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function AddToAlbumDialog({
  open,
  onOpenChange,
  photoIds,
  onAdded,
  excludeAlbumId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  photoIds: string[];
  /** Called after photos are successfully added (close + clear selection). */
  onAdded: () => void;
  /** Hide this album from the list (e.g. the album you're already viewing). */
  excludeAlbumId?: string;
}) {
  const router = useRouter();
  const [albums, setAlbums] = useState<AlbumSummaryDTO[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [newName, setNewName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAlbums(null);
    setLoadError(false);
    setNewName("");
    setError(null);
    fetch("/api/albums")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((data: { items: AlbumSummaryDTO[] }) =>
        setAlbums(data.items.filter((a) => !a.isSmart && a.id !== excludeAlbumId)),
      )
      .catch(() => setLoadError(true));
  }, [open, excludeAlbumId]);

  async function postPhotos(albumId: string) {
    const res = await fetch(`/api/albums/${albumId}/photos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ photoIds }),
    });
    if (!res.ok) throw new Error("add failed");
  }

  async function handlePick(albumId: string) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await postPhotos(albumId);
      router.refresh();
      onAdded();
    } catch {
      setError("Failed to add photos to the album.");
    } finally {
      setPending(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/albums", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, isSmart: false }),
      });
      if (!res.ok) throw new Error();
      const album = (await res.json()) as { id: string };
      await postPhotos(album.id);
      router.refresh();
      onAdded();
    } catch {
      setError("Failed to create the album.");
    } finally {
      setPending(false);
    }
  }

  const photoLabel = `${photoIds.length} ${photoIds.length === 1 ? "photo" : "photos"}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add {photoLabel} to album</DialogTitle>
        </DialogHeader>

        <form onSubmit={(e) => void handleCreate(e)} className="flex gap-2">
          <Input
            placeholder="New album from selection"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Button type="submit" variant="outline" size="sm" disabled={pending || newName.trim() === ""}>
            Create
          </Button>
        </form>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="max-h-72 space-y-1 overflow-y-auto">
          {loadError && (
            <p className="px-2 py-4 text-sm text-muted-foreground">Failed to load albums.</p>
          )}
          {albums === null && !loadError && (
            <p className="px-2 py-4 text-sm text-muted-foreground">Loading…</p>
          )}
          {albums?.length === 0 && (
            <p className="px-2 py-4 text-sm text-muted-foreground">
              No albums yet — create one above.
            </p>
          )}
          {albums?.map((album) => (
            <button
              key={album.id}
              type="button"
              disabled={pending}
              onClick={() => void handlePick(album.id)}
              className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-muted disabled:opacity-50"
            >
              <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                {album.coverPhotoId ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/thumbnails/${album.coverPhotoId}`}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <Images className="size-4 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{album.name}</p>
                <p className="text-xs text-muted-foreground">
                  {album.photoCount} {album.photoCount === 1 ? "photo" : "photos"}
                </p>
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify lint**

Run: `pnpm --filter @lumio/web lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(app)/photos/add-to-album-dialog.tsx"
git commit -m "feat(web): AddToAlbumDialog (existing album + new-from-selection)"
```

---

## Task 9: `LibraryView` + wire `/photos`

**Files:**
- Create: `apps/web/src/app/(app)/photos/library-view.tsx`
- Modify: `apps/web/src/app/(app)/photos/page.tsx`

- [ ] **Step 1: Create `LibraryView`**

Create `apps/web/src/app/(app)/photos/library-view.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useGridSelection } from "@/lib/use-grid-selection";
import { PhotoGrid } from "./photo-grid";
import { SelectionToolbar } from "./selection-toolbar";
import { AddToAlbumDialog } from "./add-to-album-dialog";

export function LibraryView() {
  const sel = useGridSelection();
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      {sel.selectMode ? (
        <SelectionToolbar
          title="Select photos"
          count={sel.count}
          onCancel={sel.cancel}
          actions={
            <Button size="sm" disabled={sel.count === 0} onClick={() => setDialogOpen(true)}>
              Add to album
            </Button>
          }
        />
      ) : (
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Library</h1>
          <Button variant="outline" size="sm" onClick={sel.enter}>
            Select
          </Button>
        </div>
      )}

      <PhotoGrid
        selectMode={sel.selectMode}
        selectedIds={sel.selected}
        onSelectionChange={sel.setSelected}
      />

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

- [ ] **Step 2: Wire the page**

Replace the contents of `apps/web/src/app/(app)/photos/page.tsx` with:

```tsx
import { LibraryView } from "./library-view";

export default function PhotosPage() {
  return (
    <main className="w-full p-6">
      <LibraryView />
    </main>
  );
}
```

- [ ] **Step 3: Verify lint**

Run: `pnpm --filter @lumio/web lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(app)/photos/library-view.tsx" "apps/web/src/app/(app)/photos/page.tsx"
git commit -m "feat(web): Library header + select mode on /photos"
```

---

## Task 10: `AlbumView` + wire `/albums/[id]`

**Files:**
- Create: `apps/web/src/app/(app)/albums/[id]/album-view.tsx`
- Modify: `apps/web/src/app/(app)/albums/[id]/page.tsx`

- [ ] **Step 1: Create `AlbumView`**

Create `apps/web/src/app/(app)/albums/[id]/album-view.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Images } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGridSelection } from "@/lib/use-grid-selection";
import { PhotoGrid } from "@/app/(app)/photos/photo-grid";
import { SelectionToolbar } from "@/app/(app)/photos/selection-toolbar";
import { AddToAlbumDialog } from "@/app/(app)/photos/add-to-album-dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { DeleteAlbumButton } from "./delete-album-button";

export function AlbumView({
  albumId,
  albumName,
  isSmart,
}: {
  albumId: string;
  albumName: string;
  isSmart: boolean;
}) {
  const sel = useGridSelection();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [removing, setRemoving] = useState(false);

  async function handleRemove() {
    const ids = [...sel.selected];
    if (ids.length === 0 || removing) return;
    const label = `${ids.length} ${ids.length === 1 ? "photo" : "photos"}`;
    if (!confirm(`Remove ${label} from this album?`)) return;
    setRemoving(true);
    try {
      const res = await fetch(`/api/albums/${albumId}/photos`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ photoIds: ids }),
      });
      if (res.ok) {
        sel.cancel();
        setReloadKey((k) => k + 1);
      }
    } finally {
      setRemoving(false);
    }
  }

  return (
    <>
      {sel.selectMode ? (
        <SelectionToolbar
          title={albumName}
          count={sel.count}
          onCancel={sel.cancel}
          actions={
            <>
              <Button size="sm" disabled={sel.count === 0} onClick={() => setDialogOpen(true)}>
                Add to album
              </Button>
              {!isSmart && (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={sel.count === 0 || removing}
                  onClick={() => void handleRemove()}
                >
                  {removing ? "Removing…" : "Remove from album"}
                </Button>
              )}
            </>
          }
        />
      ) : (
        <div className="mb-6 flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold">{albumName}</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={sel.enter}>
              Select
            </Button>
            <DeleteAlbumButton albumId={albumId} />
          </div>
        </div>
      )}

      <PhotoGrid
        key={reloadKey}
        endpoint={`/api/albums/${albumId}/photos`}
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

      <AddToAlbumDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        photoIds={[...sel.selected]}
        excludeAlbumId={albumId}
        onAdded={() => {
          setDialogOpen(false);
          sel.cancel();
        }}
      />
    </>
  );
}
```

- [ ] **Step 2: Wire the page**

Replace the contents of `apps/web/src/app/(app)/albums/[id]/page.tsx` with:

```tsx
import { notFound } from "next/navigation";
import { getAlbum } from "@/lib/albums-service";
import { AlbumView } from "./album-view";

export const dynamic = "force-dynamic";

export default async function AlbumDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const album = await getAlbum(id);
  if (!album) notFound();

  return (
    <main className="w-full p-6">
      <AlbumView albumId={album.id} albumName={album.name} isSmart={album.isSmart} />
    </main>
  );
}
```

- [ ] **Step 3: Verify lint + full web tests**

Run: `pnpm --filter @lumio/web lint`
Expected: no errors.

Run: `pnpm --filter @lumio/web test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(app)/albums/[id]/album-view.tsx" "apps/web/src/app/(app)/albums/[id]/page.tsx"
git commit -m "feat(web): select mode on album page (add to other album + remove)"
```

---

## Task 11: Manual browser verification

**Files:** none (verification only).

Prereqs: DB up and seeded with photos + at least one manual album and one smart album. Start the app: `pnpm dev` (from repo root). Sign in, then walk the checklist. Note: the app uses native `confirm()` for remove — if driving via browser automation, expect a blocking dialog and dismiss it.

- [ ] **Step 1: `/photos` header + enter/exit**
  - Visit `/photos`. Header shows **Library** (left) + **Select** (right).
  - Click **Select** → header becomes **Select photos** + **Cancel** + disabled **Add to album**. Tiles show empty check circles and no longer navigate on click.
  - Click **Cancel** → returns to the Library header; clicking a tile navigates to `/photo/[id]` again.

- [ ] **Step 2: Toggle + shift-range**
  - Enter select mode. Click a tile → it gets a ring + filled check; header shows "1 selected"; **Add to album** enables.
  - Click the same tile → deselects.
  - Click tile A, then shift-click a later tile B → the inclusive A→B range is selected. Count matches.

- [ ] **Step 3: Add to existing album**
  - With photos selected, click **Add to album** → dialog lists manual albums (no smart albums). Pick one → dialog closes, select mode exits. Open that album → the photos are present.

- [ ] **Step 4: New album from selection**
  - Select photos → **Add to album** → type a name in "New album from selection" → **Create**. Dialog closes, select mode exits. Visit `/albums` → the new album exists with the chosen photos.

- [ ] **Step 5: Album page — add to a different album**
  - Open a manual album. Header shows name + **Select** + **Delete**. Click **Select** → toolbar with **Add to album** + **Remove from album**.
  - Select photos → **Add to album** → confirm the current album is **absent** from the list. Pick another album → photos added there; the current album's grid is unchanged (the photo can be in both).

- [ ] **Step 6: Album page — remove from album**
  - In a manual album, select photos → **Remove from album** → accept the `confirm()`. The removed tiles disappear from the grid (it reloads). Reopen `/photos` → the photos still exist in the library (only the album link was removed).

- [ ] **Step 7: Smart album**
  - Open a smart album → **Select**. Toolbar shows **Add to album** but **no Remove from album** button.

- [ ] **Step 8: Final full check**
  - Run: `pnpm -r test` → all packages PASS.
  - Run: `pnpm --filter @lumio/web lint` → clean.
```
