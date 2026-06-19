# Albums Page: Select, Grid-Size, and Smart/Regular Split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Select (bulk-delete), an independent grid-size slider, and a smart/regular section split to the `/albums` listing page.

**Architecture:** Slim `albums/page.tsx` (server) to fetch summaries and render a new client `AlbumsView`, mirroring `photos/page.tsx → LibraryView`. Selection reuses the ID-agnostic `useGridSelection`; album density gets its own persisted store via a factory extracted from `use-grid-columns`. Bulk delete is a new `deleteAlbums` service + `DELETE /api/albums` route. After a delete, `router.refresh()` re-runs the server fetch.

**Tech Stack:** Next.js (App Router, server + client components), React 19 (`useSyncExternalStore`), Prisma, Zod, Vitest (node env — pure-function tests only), Tailwind, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-06-19-albums-page-select-grid-size-split-design.md`

---

## File Structure

**Create:**
- `packages/shared/src/albums.ts` — (modify) add `deleteAlbumsSchema` + `DeleteAlbumsInput`.
- `apps/web/src/lib/columns-store.ts` — `parseColumns` + `makeColumnsStore({ storageKey, syncCssVar })` factory.
- `apps/web/src/lib/use-album-columns.ts` — `useAlbumColumns` hook (separate key, no CSS-var).
- `apps/web/src/lib/partition-albums.ts` — `partitionAlbums(albums)` pure helper.
- `apps/web/src/lib/partition-albums.test.ts` — its test.
- `apps/web/src/app/(app)/albums/album-card.tsx` — selectable album card.
- `apps/web/src/app/(app)/albums/albums-view.tsx` — client view (header + sections + selection + delete).

**Modify:**
- `apps/web/src/lib/albums-service.ts` — add `deleteAlbums`.
- `apps/web/src/lib/albums-service.test.ts` — add `deleteAlbums` test.
- `apps/web/src/lib/grid-layout.ts` — add `ALBUM_COLUMNS_STORAGE_KEY`.
- `apps/web/src/lib/use-grid-columns.ts` — refactor to use the factory (keep `parseGridColumns` export).
- `apps/web/src/app/api/albums/route.ts` — add `DELETE` handler.
- `apps/web/src/app/(app)/albums/page.tsx` — slim to fetch + `<AlbumsView>`.

**Test runner notes:**
- Web tests: `pnpm --filter @lumio/web test` (vitest, `environment: "node"` — no DOM, so only pure functions are unit-tested; components are verified manually in the browser).
- Shared tests: `pnpm --filter @lumio/shared test`.
- A single web test file: `pnpm --filter @lumio/web exec vitest run src/lib/partition-albums.test.ts`.

---

## Task 1: `deleteAlbumsSchema` in @lumio/shared

**Files:**
- Modify: `packages/shared/src/albums.ts`
- Test: `packages/shared/src/albums.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/albums.test.ts`. Also add `deleteAlbumsSchema` to the existing import on line 2 (`import { albumPhotosSchema, createAlbumSchema, deleteAlbumsSchema, smartRulesSchema } from "./albums.js";`):

```ts
describe("deleteAlbumsSchema", () => {
  it("accepts a non-empty ids array", () => {
    const result = deleteAlbumsSchema.parse({ ids: ["a1", "a2"] });
    expect(result.ids).toEqual(["a1", "a2"]);
  });

  it("rejects an empty ids array", () => {
    expect(() => deleteAlbumsSchema.parse({ ids: [] })).toThrow();
  });

  it("rejects an ids entry that is an empty string", () => {
    expect(() => deleteAlbumsSchema.parse({ ids: [""] })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/shared test`
Expected: FAIL — `deleteAlbumsSchema` is not exported (import error / undefined).

- [ ] **Step 3: Add the schema**

In `packages/shared/src/albums.ts`, after the `albumPhotosSchema` block (around line 34), add:

```ts
export const deleteAlbumsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});
export type DeleteAlbumsInput = z.infer<typeof deleteAlbumsSchema>;
```

(`export * from "./albums.js"` in `packages/shared/src/index.ts` re-exports it automatically.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/shared test`
Expected: PASS (all `albums.test.ts` suites green).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/albums.ts packages/shared/src/albums.test.ts
git commit -m "feat(shared): deleteAlbumsSchema for bulk album delete"
```

---

## Task 2: `deleteAlbums` service

**Files:**
- Modify: `apps/web/src/lib/albums-service.ts`
- Test: `apps/web/src/lib/albums-service.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/lib/albums-service.test.ts`. Add `deleteAlbums` to the existing import block from `./albums-service.js` (top of file):

```ts
describe("deleteAlbums", () => {
  it("deleteMany on the given ids and returns the removed count", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const fakeDb = { album: { deleteMany }, albumPhoto: {}, photo: {} };
    const count = await deleteAlbums(["a1", "s1"], fakeDb as never);
    expect(count).toBe(2);
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["a1", "s1"] } } });
  });

  it("returns 0 when no ids match", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const fakeDb = { album: { deleteMany }, albumPhoto: {}, photo: {} };
    const count = await deleteAlbums(["missing"], fakeDb as never);
    expect(count).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/albums-service.test.ts`
Expected: FAIL — `deleteAlbums` is not exported.

- [ ] **Step 3: Add the service function**

In `apps/web/src/lib/albums-service.ts`, after the existing `deleteAlbum` function (around line 61), add:

```ts
/**
 * Bulk-delete albums by id. Tolerant of unknown ids (unlike single
 * `deleteAlbum`, which throws). Works for smart and regular albums alike;
 * cascades to `albumPhoto` membership rows exactly like the single delete.
 * Returns the number of albums actually removed.
 */
export async function deleteAlbums(ids: string[], db: Db = prisma): Promise<number> {
  const { count } = await db.album.deleteMany({ where: { id: { in: ids } } });
  return count;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/albums-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/albums-service.ts apps/web/src/lib/albums-service.test.ts
git commit -m "feat(web): deleteAlbums service for bulk album delete"
```

---

## Task 3: `DELETE /api/albums` route

**Files:**
- Modify: `apps/web/src/app/api/albums/route.ts`

No unit test: this codebase tests services (Task 2), not route handlers (the existing `GET`/`POST` in this file have none). The route is verified end-to-end in the browser (Task 9).

- [ ] **Step 1: Add the DELETE handler**

Replace the entire contents of `apps/web/src/app/api/albums/route.ts` with:

```ts
import { NextResponse } from "next/server";
import { createAlbumSchema, deleteAlbumsSchema } from "@lumio/shared";
import { createAlbum, deleteAlbums, listAlbumSummaries } from "@/lib/albums-service";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async () => {
  const items = await listAlbumSummaries();
  return NextResponse.json({ items });
});

export const POST = withAuth(async (request) => {
  const body: unknown = await request.json();
  const parsed = createAlbumSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const album = await createAlbum(parsed.data);
  return NextResponse.json(album, { status: 201 });
});

export const DELETE = withAuth(async (request) => {
  const body: unknown = await request.json();
  const parsed = deleteAlbumsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const count = await deleteAlbums(parsed.data.ids);
  return NextResponse.json({ count });
});
```

- [ ] **Step 2: Verify it compiles / lints**

Run: `pnpm --filter @lumio/web lint`
Expected: PASS (no new errors in `route.ts`).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/albums/route.ts
git commit -m "feat(web): DELETE /api/albums bulk-delete endpoint"
```

---

## Task 4: Columns-store factory + album-columns hook

Extract the shared persisted-column-count logic into a factory so the album grid can have its own independent density without duplicating the store. The existing `parseGridColumns` test (`use-grid-columns.test.ts`) is the safety net for the refactor.

**Files:**
- Modify: `apps/web/src/lib/grid-layout.ts`
- Create: `apps/web/src/lib/columns-store.ts`
- Modify: `apps/web/src/lib/use-grid-columns.ts`
- Create: `apps/web/src/lib/use-album-columns.ts`
- Test (existing, must stay green): `apps/web/src/lib/use-grid-columns.test.ts`

- [ ] **Step 1: Add the album storage key constant**

In `apps/web/src/lib/grid-layout.ts`, after the `GRID_COLUMNS_STORAGE_KEY` block (around line 14), add:

```ts
// localStorage key for the /albums listing density. Separate from
// GRID_COLUMNS_STORAGE_KEY so resizing album cards never changes photo-tile
// density (and vice versa).
export const ALBUM_COLUMNS_STORAGE_KEY = "lumio:album-columns";
```

- [ ] **Step 2: Create the factory**

Create `apps/web/src/lib/columns-store.ts`:

```ts
"use client";

import { useCallback, useSyncExternalStore } from "react";
import { COLUMNS_MAX, COLUMNS_MIN, DEFAULT_COLUMNS } from "@/lib/grid-layout";

/**
 * Resolve a stored grid column count: an integer clamped to
 * [COLUMNS_MIN, COLUMNS_MAX], defaulting to DEFAULT_COLUMNS for missing/invalid
 * input. Pure for testability. (Number(null)/Number("") are 0, not NaN, so
 * null/empty must be handled before the numeric path.)
 */
export function parseColumns(stored: string | null): number {
  if (stored === null || stored.trim() === "") return DEFAULT_COLUMNS;
  const n = Number(stored);
  if (!Number.isFinite(n)) return DEFAULT_COLUMNS;
  return Math.min(COLUMNS_MAX, Math.max(COLUMNS_MIN, Math.round(n)));
}

/**
 * Build a persisted "columns per row" store bound to one localStorage key.
 * Each call owns its own same-document listener set, so independent stores
 * (the photo grid vs. the albums grid) don't notify each other. When
 * `syncCssVar` is true, writes also update the `--grid-columns` CSS variable
 * that the root-layout pre-paint script reads (photo grid only).
 */
export function makeColumnsStore({
  storageKey,
  syncCssVar,
}: {
  storageKey: string;
  syncCssVar: boolean;
}) {
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
    return parseColumns(localStorage.getItem(storageKey));
  }

  // The server (and the first hydration pass) always assume the default; the
  // real value is read on the client after mount. useSyncExternalStore swaps to
  // the client snapshot without a hydration mismatch.
  function getServerSnapshot(): number {
    return DEFAULT_COLUMNS;
  }

  return function useColumns() {
    const columns = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

    const setColumns = useCallback((next: number) => {
      localStorage.setItem(storageKey, String(next));
      if (syncCssVar) {
        // Keep the pre-paint CSS variable current so a later skeleton matches
        // without a flash.
        document.documentElement.style.setProperty("--grid-columns", String(next));
      }
      listeners.forEach((cb) => cb());
    }, []);

    return { columns, setColumns };
  };
}
```

- [ ] **Step 3: Refactor `use-grid-columns.ts` onto the factory**

Replace the entire contents of `apps/web/src/lib/use-grid-columns.ts` with:

```ts
"use client";

import { GRID_COLUMNS_STORAGE_KEY } from "@/lib/grid-layout";
import { makeColumnsStore, parseColumns } from "@/lib/columns-store";

// Back-compat re-export: existing callers and use-grid-columns.test.ts import
// parseGridColumns from here.
export const parseGridColumns = parseColumns;

/**
 * Global, persisted grid density as a column count (photos per row). Persisted
 * to localStorage so the choice carries across routes and reloads, and synced
 * across tabs via the `storage` event. Drives the `--grid-columns` CSS variable
 * read by the root-layout pre-paint script.
 */
export const useGridColumns = makeColumnsStore({
  storageKey: GRID_COLUMNS_STORAGE_KEY,
  syncCssVar: true,
});
```

- [ ] **Step 4: Create the album-columns hook**

Create `apps/web/src/lib/use-album-columns.ts`:

```ts
"use client";

import { ALBUM_COLUMNS_STORAGE_KEY } from "@/lib/grid-layout";
import { makeColumnsStore } from "@/lib/columns-store";

/**
 * Persisted album-card density (columns per row) for the /albums listing.
 * Independent from the photo-grid density: its own localStorage key and no
 * `--grid-columns` CSS-var side-effect (albums are server-rendered — no
 * skeleton to keep in sync).
 */
export const useAlbumColumns = makeColumnsStore({
  storageKey: ALBUM_COLUMNS_STORAGE_KEY,
  syncCssVar: false,
});
```

- [ ] **Step 5: Run the existing test + lint to verify the refactor is safe**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/use-grid-columns.test.ts`
Expected: PASS (all `parseGridColumns` cases still green — the function is now `parseColumns` re-exported).

Run: `pnpm --filter @lumio/web lint`
Expected: PASS. If eslint's `react-hooks/exhaustive-deps` flags `storageKey`/`syncCssVar` on the `useCallback`, add them to the dependency array (`}, [storageKey, syncCssVar]);`) — they're stable for the store's lifetime, so this is harmless.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/grid-layout.ts apps/web/src/lib/columns-store.ts \
  apps/web/src/lib/use-grid-columns.ts apps/web/src/lib/use-album-columns.ts
git commit -m "refactor(web): columns-store factory + independent useAlbumColumns"
```

---

## Task 5: `partitionAlbums` helper

**Files:**
- Create: `apps/web/src/lib/partition-albums.ts`
- Test: `apps/web/src/lib/partition-albums.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/partition-albums.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { AlbumSummaryDTO } from "@lumio/shared";
import { partitionAlbums } from "./partition-albums";

function album(id: string, isSmart: boolean): AlbumSummaryDTO {
  return {
    id,
    name: id,
    isSmart,
    rules: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    photoCount: 0,
    coverPhotoId: null,
  };
}

describe("partitionAlbums", () => {
  it("splits regular and smart albums", () => {
    const { regular, smart } = partitionAlbums([
      album("a", false),
      album("s1", true),
      album("b", false),
      album("s2", true),
    ]);
    expect(regular.map((a) => a.id)).toEqual(["a", "b"]);
    expect(smart.map((a) => a.id)).toEqual(["s1", "s2"]);
  });

  it("returns empty groups for empty input", () => {
    expect(partitionAlbums([])).toEqual({ regular: [], smart: [] });
  });

  it("preserves input order within each group", () => {
    const { regular } = partitionAlbums([album("z", false), album("a", false)]);
    expect(regular.map((a) => a.id)).toEqual(["z", "a"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/partition-albums.test.ts`
Expected: FAIL — cannot find module `./partition-albums`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/lib/partition-albums.ts`:

```ts
import type { AlbumSummaryDTO } from "@lumio/shared";

/**
 * Split albums into hand-made (regular) and smart, preserving input order
 * within each group. Drives the two labeled sections on the /albums page.
 */
export function partitionAlbums(albums: AlbumSummaryDTO[]): {
  regular: AlbumSummaryDTO[];
  smart: AlbumSummaryDTO[];
} {
  const regular: AlbumSummaryDTO[] = [];
  const smart: AlbumSummaryDTO[] = [];
  for (const album of albums) {
    (album.isSmart ? smart : regular).push(album);
  }
  return { regular, smart };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/partition-albums.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/partition-albums.ts apps/web/src/lib/partition-albums.test.ts
git commit -m "feat(web): partitionAlbums helper (regular vs smart split)"
```

---

## Task 6: `AlbumCard` component

A single album in the listing grid. Normal mode → `<Link>`; select mode → toggle `<button>` with a checkbox overlay + selected ring + shrink-on-select, mirroring `PhotoGridTile`.

**Files:**
- Create: `apps/web/src/app/(app)/albums/album-card.tsx`

No unit test (vitest is node-env, no DOM); verified in the browser in Task 9.

- [ ] **Step 1: Write the component**

Create `apps/web/src/app/(app)/albums/album-card.tsx`:

```tsx
"use client";

import Link from "next/link";
import { CheckCircle2, Circle, Images } from "lucide-react";
import type { AlbumSummaryDTO } from "@lumio/shared";
import { cn } from "@/lib/utils";

/**
 * One album in the listing grid. In select mode it's a toggle button that adds
 * or removes the album from the shared selection set (no navigation), with a
 * checkbox overlay, a selected ring, and a shrink-on-select affordance —
 * mirroring PhotoGridTile. Otherwise it's a Link to the album.
 */
export function AlbumCard({
  album,
  selectMode,
  isSelected,
  onToggle,
}: {
  album: AlbumSummaryDTO;
  selectMode: boolean;
  isSelected: boolean;
  onToggle: (id: string) => void;
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

  if (selectMode) {
    return (
      <button
        type="button"
        aria-pressed={isSelected}
        onClick={() => onToggle(album.id)}
        className="group block w-full select-none text-left"
      >
        <div
          className={cn(
            "relative rounded-sm",
            isSelected && "ring-2 ring-inset ring-primary",
          )}
        >
          <div className={cn("transition-transform", isSelected && "scale-[0.96]")}>
            {cover}
          </div>
          <span className="absolute left-2 top-2 rounded-full bg-background text-foreground">
            {isSelected ? (
              <CheckCircle2 className="size-5 text-primary" />
            ) : (
              <Circle className="size-5 text-muted-foreground" />
            )}
          </span>
        </div>
        {meta}
      </button>
    );
  }

  return (
    <Link href={`/albums/${album.id}`} className="group block">
      {cover}
      {meta}
    </Link>
  );
}
```

- [ ] **Step 2: Verify it lints/compiles**

Run: `pnpm --filter @lumio/web lint`
Expected: PASS (no errors in `album-card.tsx`).

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(app)/albums/album-card.tsx"
git commit -m "feat(web): selectable AlbumCard component"
```

---

## Task 7: `AlbumsView` client component

Owns selection + density state, renders the header (normal vs. select toolbar) and the two album sections, and runs the bulk-delete flow.

**Files:**
- Create: `apps/web/src/app/(app)/albums/albums-view.tsx`

No unit test; verified in the browser in Task 9.

- [ ] **Step 1: Write the component**

Create `apps/web/src/app/(app)/albums/albums-view.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FolderOpen } from "lucide-react";
import { toast } from "sonner";
import type { AlbumSummaryDTO } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { HeaderBar } from "@/components/header-bar";
import { GridSizeMenu } from "@/components/grid-size-menu";
import { SelectionToolbar } from "@/app/(app)/photos/selection-toolbar";
import { useGridSelection } from "@/lib/use-grid-selection";
import { useAlbumColumns } from "@/lib/use-album-columns";
import { useConfirm } from "@/components/confirm-dialog";
import { partitionAlbums } from "@/lib/partition-albums";
import { NewAlbumDialog } from "./new-album-dialog";
import { AlbumCard } from "./album-card";

export function AlbumsView({ albums }: { albums: AlbumSummaryDTO[] }) {
  const router = useRouter();
  const sel = useGridSelection();
  const { columns, setColumns } = useAlbumColumns();
  const { confirm, confirmDialog } = useConfirm();
  const [deleting, setDeleting] = useState(false);

  const { regular, smart } = partitionAlbums(albums);

  function toggle(id: string) {
    sel.setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleDelete() {
    const ids = [...sel.selected];
    if (ids.length === 0 || deleting) return;
    const label = `${ids.length} ${ids.length === 1 ? "album" : "albums"}`;
    const ok = await confirm({
      title: `Delete ${label}?`,
      description: "This can't be undone. The photos stay in your library.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/albums", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error("delete failed");
      sel.cancel();
      router.refresh();
    } catch {
      toast.error("Failed to delete albums.");
    } finally {
      setDeleting(false);
    }
  }

  if (albums.length === 0) {
    return (
      <>
        <HeaderBar title="Albums" actions={<NewAlbumDialog />} />
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderOpen />
            </EmptyMedia>
            <EmptyTitle>No albums yet</EmptyTitle>
            <EmptyDescription>Create an album to group your photos.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </>
    );
  }

  return (
    <>
      {confirmDialog}
      {sel.selectMode ? (
        <SelectionToolbar
          title="Select albums"
          count={sel.count}
          onCancel={sel.cancel}
          actions={
            <Button
              variant="destructive"
              size="sm"
              disabled={sel.count === 0 || deleting}
              onClick={() => void handleDelete()}
            >
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          }
        />
      ) : (
        <HeaderBar
          title="Albums"
          actions={
            <>
              <GridSizeMenu columns={columns} onColumnsChange={setColumns} />
              <Button variant="outline" size="sm" onClick={sel.enter}>
                Select
              </Button>
              <NewAlbumDialog />
            </>
          }
        />
      )}

      <div className="space-y-8">
        {regular.length > 0 && (
          <AlbumSection
            title="Albums"
            albums={regular}
            columns={columns}
            selectMode={sel.selectMode}
            selected={sel.selected}
            onToggle={toggle}
          />
        )}
        {smart.length > 0 && (
          <AlbumSection
            title="Smart Albums"
            albums={smart}
            columns={columns}
            selectMode={sel.selectMode}
            selected={sel.selected}
            onToggle={toggle}
          />
        )}
      </div>
    </>
  );
}

function AlbumSection({
  title,
  albums,
  columns,
  selectMode,
  selected,
  onToggle,
}: {
  title: string;
  albums: AlbumSummaryDTO[];
  columns: number;
  selectMode: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{title}</h2>
      <div
        className="grid gap-x-5 gap-y-7"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {albums.map((album) => (
          <AlbumCard
            key={album.id}
            album={album}
            selectMode={selectMode}
            isSelected={selected.has(album.id)}
            onToggle={onToggle}
          />
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify it lints/compiles**

Run: `pnpm --filter @lumio/web lint`
Expected: PASS (no errors in `albums-view.tsx`).

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(app)/albums/albums-view.tsx"
git commit -m "feat(web): AlbumsView with select, grid-size, and section split"
```

---

## Task 8: Slim `albums/page.tsx` to render `AlbumsView`

**Files:**
- Modify: `apps/web/src/app/(app)/albums/page.tsx`

- [ ] **Step 1: Replace the page**

Replace the entire contents of `apps/web/src/app/(app)/albums/page.tsx` with:

```tsx
import { listAlbumSummaries } from "@/lib/albums-service";
import { AlbumsView } from "./albums-view";

export const dynamic = "force-dynamic";

export default async function AlbumsPage() {
  const albums = await listAlbumSummaries();

  return (
    <main className="w-full px-6 pb-6">
      <AlbumsView albums={albums} />
    </main>
  );
}
```

- [ ] **Step 2: Verify it lints/compiles**

Run: `pnpm --filter @lumio/web lint`
Expected: PASS. (The previously-used `Link`, `FolderOpen`, `Images`, `Empty*` imports now live in `albums-view.tsx`/`album-card.tsx`; the page no longer references them.)

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(app)/albums/page.tsx"
git commit -m "feat(web): wire /albums page to AlbumsView"
```

---

## Task 9: Full verification (automated + manual browser)

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `pnpm -r test`
Expected: PASS — including the new `deleteAlbumsSchema`, `deleteAlbums`, and `partitionAlbums` tests, and the unchanged `parseGridColumns` test.

- [ ] **Step 2: Lint the web app**

Run: `pnpm --filter @lumio/web lint`
Expected: PASS, no errors.

- [ ] **Step 3: Typecheck via build**

Run: `pnpm --filter @lumio/web build`
Expected: Build succeeds (Next.js type-checks the app during build). If it fails, fix type errors and re-run.

- [ ] **Step 4: Manual browser verification**

Start the app (`pnpm dev`) and open `/albums`. Confirm:
- Header shows **Grid size**, **Select**, and **New album** in normal mode.
- The **Grid size** slider changes album-card density and the choice **persists** across reload.
- Open `/photos` and confirm its density is **unchanged** by the album slider (independent stores), and vice-versa.
- Regular albums appear under an **"Albums"** heading and smart albums under **"Smart Albums"**; a section with no albums is hidden.
- **Select** → cards become toggles with checkmark overlays; selecting across *both* sections updates one shared count in the toolbar.
- **Escape** clears the selection, then (pressed again) exits select mode.
- **Delete** opens the confirm dialog ("Delete N albums?"), and on confirm the albums disappear (page refreshes), selection mode exits, and a mix of smart + regular deletes correctly. The deleted albums' photos still exist in `/photos`.
- With **no albums at all**, the "No albums yet" empty state shows with just **New album** in the header.

- [ ] **Step 5: Final commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix(web): address albums-page verification findings"
```

(Skip if Steps 1–4 passed with no changes.)

---

## Self-Review Notes (addressed)

- **Spec coverage:** Select/bulk-delete → Tasks 1–3, 7. Independent grid-size → Tasks 4, 7. Smart/regular split → Tasks 5, 7. Server/client split → Task 8. Tests (factory parse, `deleteAlbums`, `partitionAlbums`) → Tasks 1–2, 4–5. All spec sections map to a task.
- **No pre-paint `--album-columns`** (per spec trade-off): `useAlbumColumns` uses `syncCssVar: false`.
- **Type consistency:** `deleteAlbumsSchema` (Task 1) → `deleteAlbums(ids)` (Task 2) → `DELETE` route body `{ ids }` (Task 3) → `AlbumsView` fetch body `{ ids }` (Task 7). `useAlbumColumns()` returns `{ columns, setColumns }` (Task 4), consumed by `AlbumsView`/`GridSizeMenu` (Task 7). `partitionAlbums` returns `{ regular, smart }` (Task 5), consumed in Task 7. `AlbumCard` props (`album`, `selectMode`, `isSelected`, `onToggle`) match `AlbumSection`'s usage.
