# `/folders` Album-Style Cards + Selection + Calendar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the disk `/folders` page up to the `/albums` look & feel — album-style folder cards (2×2 cover mosaic + "N folders · M photos"), selectable like `/albums` (ring, click/⌘/shift, double-click opens), plus a month calendar on the photos.

**Architecture:** Photos keep using the shared `PhotoLibraryView`; the Folders section renders in its `aboveGrid` slot with its OWN selection state (separate from the photo grid). A new server helper `listSubfolderSummaries` enriches each immediate subfolder with a recursive photo count + ≤4 cover ids (from the indexed `Photo.dirPath` column) and an immediate subfolder count (from the filesystem). A new `/fs/calendar` route + `month` support on `/fs/photos` light up the calendar. Filesystem rename/move/delete are deferred — the selection is the hook for them later.

**Tech Stack:** Next.js 16 App Router (web), Prisma/Postgres, Vitest, TanStack virtualizer (existing PhotoGrid), Tailwind.

**Reference (spec):** `docs/superpowers/specs/2026-06-23-folders-album-style-cards.md`

**Key invariant — direct vs. recursive:** the photo *grid* and the *calendar* are **direct** (`dirPath === rel`, the folder's own photos). Recursion applies ONLY to the folder *cards'* covers + photo counts. The subfolder count on a card is **immediate** (direct children only).

---

## File Structure

- `apps/web/src/lib/catalog-fs-service.ts` — add `FolderSummary`, `subtreeWhere`, `FolderSummaryDeps`, `listSubfolderSummaries` (Task 1); remove old `Subfolder`/`SubfolderDeps`/`listSubfolders` (Task 5).
- `apps/web/src/lib/catalog-fs-service.test.ts` — add tests for the new helpers (Task 1); remove old `listSubfolders` tests (Task 5).
- `apps/web/src/lib/folder-subtitle.ts` + `.test.ts` — new pure subtitle helper (Task 3).
- `apps/web/src/app/api/c/[catalog]/fs/calendar/route.ts` — new direct-scope calendar route (Task 2).
- `apps/web/src/app/api/c/[catalog]/fs/photos/route.ts` — add `month` filter (Task 2).
- `apps/web/src/app/(app)/c/[catalog]/folders/disk-folder-card.tsx` — new album-style folder card (Task 3).
- `apps/web/src/app/(app)/c/[catalog]/folders/folders-section.tsx` — rewrite: selectable card grid + inline selection bar (Task 4).
- `apps/web/src/app/(app)/c/[catalog]/folders/folder-explorer.tsx` — pass summaries + calendar + month (Task 4).
- `apps/web/src/app/(app)/c/[catalog]/folders/page.tsx` — call `listSubfolderSummaries` (Task 4).

---

## Task 1: Server — folder summaries data layer

**Files:**
- Modify: `apps/web/src/lib/catalog-fs-service.ts`
- Test: `apps/web/src/lib/catalog-fs-service.test.ts`

Additive only — leaves the existing `listSubfolders`/`Subfolder` in place (removed in Task 5) so the build stays green.

- [ ] **Step 1: Write the failing tests** — append to `apps/web/src/lib/catalog-fs-service.test.ts` (keep the existing `describe("listSubfolders", …)` block):

```ts
import { listSubfolderSummaries, subtreeWhere, type FolderSummaryDeps } from "./catalog-fs-service.js";

describe("subtreeWhere", () => {
  it("matches the dir itself and any descendant", () => {
    expect(subtreeWhere("cat1", "2024/trip")).toEqual({
      catalogId: "cat1",
      OR: [{ dirPath: "2024/trip" }, { dirPath: { startsWith: "2024/trip/" } }],
    });
  });
});

describe("listSubfolderSummaries", () => {
  function dirent(name: string, isDir: boolean) {
    return { name, isDirectory: () => isDir };
  }
  const catalog = { id: "cat1", path: "/media/fam" };

  it("summarizes each immediate subfolder (sorted) with recursive count/previews + immediate subfolder count", async () => {
    const tree: Record<string, { name: string; isDirectory: () => boolean }[]> = {
      "/media/fam/2024": [dirent("b", true), dirent("a", true), dirent("x.jpg", false)],
      "/media/fam/2024/a": [dirent("sub1", true), dirent("sub2", true), dirent("p.jpg", false)],
      "/media/fam/2024/b": [dirent("y.jpg", false)],
    };
    const deps: FolderSummaryDeps = {
      readdir: async (abs) => tree[abs] ?? [],
      countPhotos: async (_c, rel) => (rel === "2024/a" ? 5 : 2),
      previewPhotoIds: async (_c, rel) => (rel === "2024/a" ? ["p1", "p2"] : ["p3"]),
    };
    expect(await listSubfolderSummaries(catalog, "2024", deps)).toEqual([
      { name: "a", rel: "2024/a", subfolderCount: 2, photoCount: 5, previewPhotoIds: ["p1", "p2"] },
      { name: "b", rel: "2024/b", subfolderCount: 0, photoCount: 2, previewPhotoIds: ["p3"] },
    ]);
  });

  it("blocks path traversal", async () => {
    const deps: FolderSummaryDeps = {
      readdir: async () => [],
      countPhotos: async () => 0,
      previewPhotoIds: async () => [],
    };
    await expect(listSubfolderSummaries(catalog, "../x", deps)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @lumio/web test -- src/lib/catalog-fs-service.test.ts`
Expected: FAIL — `listSubfolderSummaries`/`subtreeWhere` are not exported.

- [ ] **Step 3: Implement the helpers** — add to `apps/web/src/lib/catalog-fs-service.ts`. Add the imports at the top (alongside the existing `readdir`/`originalPath`/`joinRel` imports):

```ts
import { type Prisma, prisma } from "@lumio/db";
import { PHOTO_ORDER } from "@/lib/photo-order";
```

Then append:

```ts
export interface FolderSummary {
  name: string;
  rel: string;
  /** Immediate subdirectories on disk (incl. empty ones). */
  subfolderCount: number;
  /** Photos in this folder's whole subtree (recursive, via dirPath). */
  photoCount: number;
  /** ≤4 cover ids for the subtree, canonical (newest-taken) order. */
  previewPhotoIds: string[];
}

/** Photos in directory `rel` OR any descendant of it (recursive subtree).
 *  `rel` must be a non-empty catalog-relative dir. */
export function subtreeWhere(catalogId: string, rel: string): Prisma.PhotoWhereInput {
  return { catalogId, OR: [{ dirPath: rel }, { dirPath: { startsWith: `${rel}/` } }] };
}

export interface FolderSummaryDeps {
  readdir: (absPath: string) => Promise<{ name: string; isDirectory: () => boolean }[]>;
  countPhotos: (catalogId: string, subtreeRel: string) => Promise<number>;
  previewPhotoIds: (catalogId: string, subtreeRel: string) => Promise<string[]>;
}

const folderSummaryDeps: FolderSummaryDeps = {
  readdir: (absPath) => readdir(absPath, { withFileTypes: true }),
  countPhotos: (catalogId, rel) => prisma.photo.count({ where: subtreeWhere(catalogId, rel) }),
  previewPhotoIds: (catalogId, rel) =>
    prisma.photo
      .findMany({ where: subtreeWhere(catalogId, rel), orderBy: PHOTO_ORDER, take: 4, select: { id: true } })
      .then((rows) => rows.map((r) => r.id)),
};

/** Immediate subdirectories of catalog-relative `rel` ("" = root), each enriched
 *  with a recursive photo count + ≤4 cover ids (from the indexed dirPath column)
 *  and an immediate subfolder count (from the filesystem). Sorted by name. Bounded
 *  to the catalog dir via originalPath (throws on traversal). The DB work is
 *  parallel per subfolder — bounded to one level's fan-out, never a recursive walk. */
export async function listSubfolderSummaries(
  catalog: { id: string; path: string },
  rel: string,
  deps: FolderSummaryDeps = folderSummaryDeps,
): Promise<FolderSummary[]> {
  const absDir = originalPath(catalog, rel); // throws on traversal
  const entries = await deps.readdir(absDir);
  const subdirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, rel: joinRel(rel, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return Promise.all(
    subdirs.map(async (sub) => {
      const [children, photoCount, previewPhotoIds] = await Promise.all([
        deps.readdir(originalPath(catalog, sub.rel)),
        deps.countPhotos(catalog.id, sub.rel),
        deps.previewPhotoIds(catalog.id, sub.rel),
      ]);
      return {
        name: sub.name,
        rel: sub.rel,
        subfolderCount: children.filter((e) => e.isDirectory()).length,
        photoCount,
        previewPhotoIds,
      };
    }),
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @lumio/web test -- src/lib/catalog-fs-service.test.ts`
Expected: PASS (old `listSubfolders` tests + new `subtreeWhere`/`listSubfolderSummaries` tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/catalog-fs-service.ts apps/web/src/lib/catalog-fs-service.test.ts
git commit -m "feat(web): listSubfolderSummaries — recursive counts + covers for folder cards"
```

---

## Task 2: API — direct-scope calendar route + month filter on /fs/photos

**Files:**
- Create: `apps/web/src/app/api/c/[catalog]/fs/calendar/route.ts`
- Modify: `apps/web/src/app/api/c/[catalog]/fs/photos/route.ts`

No unit tests — this repo's `fs/*` routes are integration-only (verified by build + the Task 5 browser check), matching the existing `fs/photos` route which has no unit test.

- [ ] **Step 1: Create the calendar route** — `apps/web/src/app/api/c/[catalog]/fs/calendar/route.ts`:

```ts
import { NextResponse } from "next/server";
import { isFeatureEnabled } from "@lumio/db";
import { FeatureKey } from "@lumio/shared";
import { buildCalendarFacets } from "@/lib/calendar-service";
import { withCatalog } from "@/lib/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Year→month calendar facets for the photos that live DIRECTLY in directory
 * `?path=<rel>` (default root) — matching the /folders grid, which is also direct
 * (not recursive). Gated by the disk-explorer feature.
 */
export const GET = withCatalog(async (request, _context, { catalog }) => {
  if (!(await isFeatureEnabled(catalog.id, FeatureKey.DiskExplorer))) {
    return new Response("Not found", { status: 404 });
  }
  const dir = new URL(request.url).searchParams.get("path") ?? "";
  const facets = await buildCalendarFacets(catalog.id, { dirPath: dir });
  return NextResponse.json(facets);
});
```

- [ ] **Step 2: Add the `month` filter to `/fs/photos`** — edit `apps/web/src/app/api/c/[catalog]/fs/photos/route.ts`.

Update the imports:

```ts
import { NextResponse } from "next/server";
import { type Prisma, isFeatureEnabled } from "@lumio/db";
import { coercePhotoSort, FeatureKey, monthParamSchema, monthRange } from "@lumio/shared";
import { withCatalog } from "@/lib/with-catalog";
import { listPhotosForWhere } from "@/lib/photos-service";
```

Replace the body from `const sort = …` through the `listPhotosForWhere` call with:

```ts
  const sort = coercePhotoSort(searchParams.get("sort") ?? undefined);
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 50));
  const offset = Math.max(0, Number(searchParams.get("offset")) || 0);

  // Direct membership: the folder's OWN photos. An optional ?month filter narrows
  // by sortDate (same as the library/album calendar); an invalid month is ignored.
  const where: Prisma.PhotoWhereInput = { dirPath: dir };
  const month = monthParamSchema.safeParse(searchParams.get("month") ?? undefined);
  if (month.success) where.sortDate = monthRange(month.data);

  const page = await listPhotosForWhere(catalog.id, where, { limit, offset, sort });
  return NextResponse.json(page);
```

- [ ] **Step 3: Typecheck the web app**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: PASS (pre-existing `calendar.ts` errors, if any, are unrelated — see Task 5 note). No new errors in `fs/calendar/route.ts` or `fs/photos/route.ts`.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/api/c/[catalog]/fs/calendar/route.ts" "apps/web/src/app/api/c/[catalog]/fs/photos/route.ts"
git commit -m "feat(web): /fs/calendar facets + month filter on /fs/photos"
```

---

## Task 3: Folder subtitle helper + DiskFolderCard component

**Files:**
- Create: `apps/web/src/lib/folder-subtitle.ts`
- Test: `apps/web/src/lib/folder-subtitle.test.ts`
- Create: `apps/web/src/app/(app)/c/[catalog]/folders/disk-folder-card.tsx`

The card is presentational (verified by build + browser); its only logic — the subtitle — is extracted into a pure, tested helper. The card is not wired in until Task 4 (an unused export is fine).

- [ ] **Step 1: Write the failing subtitle test** — `apps/web/src/lib/folder-subtitle.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { folderSubtitle } from "./folder-subtitle.js";

describe("folderSubtitle", () => {
  it("always shows the subfolder count and adds photos when > 0", () => {
    expect(folderSubtitle(2, 5)).toBe("2 folders · 5 photos");
    expect(folderSubtitle(1, 1)).toBe("1 folder · 1 photo");
  });
  it("omits the photo segment when there are no photos", () => {
    expect(folderSubtitle(3, 0)).toBe("3 folders");
    expect(folderSubtitle(0, 0)).toBe("0 folders");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @lumio/web test -- src/lib/folder-subtitle.test.ts`
Expected: FAIL — `folderSubtitle` not found.

- [ ] **Step 3: Implement the helper** — `apps/web/src/lib/folder-subtitle.ts`:

```ts
import { countLabel } from "@/lib/count-label";

/** "{n} folders · {m} photos" — the subfolder count always shows, the photo count
 *  only when > 0 (mirrors the /albums folder card subtitle). */
export function folderSubtitle(subfolderCount: number, photoCount: number): string {
  const parts = [countLabel(subfolderCount, "folder", "folders")];
  if (photoCount > 0) parts.push(countLabel(photoCount, "photo", "photos"));
  return parts.join(" · ");
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @lumio/web test -- src/lib/folder-subtitle.test.ts`
Expected: PASS.

- [ ] **Step 5: Create the card** — `apps/web/src/app/(app)/c/[catalog]/folders/disk-folder-card.tsx`:

```tsx
"use client";

import { Folder as FolderIcon } from "lucide-react";
import { SelectionRing } from "@/components/photo-grid/selection-ring";
import { catalogApiUrl, catalogPath } from "@/lib/catalog-api";
import { folderSubtitle } from "@/lib/folder-subtitle";
import type { FolderSummary } from "@/lib/catalog-fs-service";

/**
 * One disk folder in the /folders listing — album-style: a 2×2 cover mosaic (or a
 * folder icon when empty), the folder name, and a "{n} folders · {m} photos"
 * subtitle. Plain left click selects only it; ⌘/Ctrl click toggles a
 * multi-selection; shift click extends a range; double click opens it; middle
 * click opens the native link (new tab). Mirrors /albums' FolderCard.
 */
export function DiskFolderCard({
  slug,
  folder,
  isSelected,
  onSelect,
  onOpen,
}: {
  slug: string;
  folder: FolderSummary;
  isSelected: boolean;
  onSelect: (rel: string, e: React.MouseEvent) => void;
  onOpen: (rel: string) => void;
}) {
  const previews = folder.previewPhotoIds;
  return (
    <a
      href={`${catalogPath(slug, "/folders")}?path=${encodeURIComponent(folder.rel)}`}
      data-card-id={folder.rel}
      onClick={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        onSelect(folder.rel, e);
      }}
      onDoubleClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onOpen(folder.rel);
      }}
      className="group block select-none"
    >
      <div className="relative rounded-sm">
        <div className="relative grid aspect-[4/3] grid-cols-2 grid-rows-2 gap-px overflow-hidden rounded-sm bg-muted">
          {previews.length === 0 ? (
            <div className="col-span-2 row-span-2 flex items-center justify-center">
              <FolderIcon className="size-8 text-muted-foreground" />
            </div>
          ) : (
            Array.from({ length: 4 }).map((_, i) =>
              previews[i] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={previews[i]}
                  src={catalogApiUrl(slug, `/photos/${previews[i]}/thumbnail`)}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div key={i} className="bg-muted" />
              ),
            )
          )}
        </div>
        {isSelected && <SelectionRing className="rounded-sm" />}
      </div>
      <div className="mt-2.5">
        <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
          <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          {folder.name}
        </p>
        <p className="text-xs text-muted-foreground">
          {folderSubtitle(folder.subfolderCount, folder.photoCount)}
        </p>
      </div>
    </a>
  );
}
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: PASS (no new errors; `FolderSummary` resolves from Task 1).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/folder-subtitle.ts apps/web/src/lib/folder-subtitle.test.ts "apps/web/src/app/(app)/c/[catalog]/folders/disk-folder-card.tsx"
git commit -m "feat(web): DiskFolderCard + folderSubtitle helper"
```

---

## Task 4: Wire it together — selectable FoldersSection, explorer calendar/month, page

**Files:**
- Rewrite: `apps/web/src/app/(app)/c/[catalog]/folders/folders-section.tsx`
- Modify: `apps/web/src/app/(app)/c/[catalog]/folders/folder-explorer.tsx`
- Modify: `apps/web/src/app/(app)/c/[catalog]/folders/page.tsx`

This cohesive task switches the whole page onto `FolderSummary`, so the types line up in one commit.

**On reuse of selection:** the Folders section drives selection with the shared pure reducer `computeSelection` (the same primitive `useGridSelectionNav` uses), NOT the full `useGridSelectionNav` hook. The full hook registers a global arrow-key keydown listener; on `/folders` that would fight the photo grid's own arrow-key handler below it (two listeners on `document`). So we reuse `useGridSelection` (state + Escape-to-clear) + `computeSelection` (click/⌘/shift math) and skip global arrow-key nav for folder cards in v1. Keyboard users can Tab to a card (a real `<a>`) and press Enter to open it natively.

- [ ] **Step 1: Rewrite `folders-section.tsx`:**

```tsx
"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useGridSelection } from "@/lib/use-grid-selection";
import { computeSelection } from "@/lib/grid-selection";
import { catalogPath } from "@/lib/catalog-api";
import type { FolderSummary } from "@/lib/catalog-fs-service";
import { DiskFolderCard } from "./disk-folder-card";

function folderHref(slug: string, rel: string): string {
  return `${catalogPath(slug, "/folders")}?path=${encodeURIComponent(rel)}`;
}

/**
 * Album-style, selectable folder cards above the photo grid; hidden when there
 * are none. Owns its OWN selection, separate from the photo grid below: click
 * selects only that folder, ⌘/Ctrl toggles, shift extends a range; double click
 * (or the card link) opens. Filesystem actions (rename/move/delete) are deferred —
 * the selection bar is the hook for them.
 */
export function FoldersSection({ slug, folders }: { slug: string; folders: FolderSummary[] }) {
  const router = useRouter();
  const sel = useGridSelection();
  const anchorRef = useRef<number | null>(null);

  // Reset the shift-range anchor whenever the selection empties (Escape / Cancel),
  // so the next shift-click starts a fresh range. Refs are written in an effect,
  // never during render.
  const empty = sel.count === 0;
  useEffect(() => {
    if (empty) anchorRef.current = null;
  }, [empty]);

  if (folders.length === 0) return null;

  const ids = folders.map((f) => f.rel);

  function onSelect(rel: string, e: React.MouseEvent) {
    const index = ids.indexOf(rel);
    if (index < 0) return;
    const next = computeSelection(
      sel.selected,
      ids,
      index,
      { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey },
      anchorRef.current,
    );
    if (!e.shiftKey) anchorRef.current = index;
    sel.setSelected(next);
  }

  function onOpen(rel: string) {
    router.push(folderHref(slug, rel));
  }

  return (
    <section className="mb-8">
      <div className="mb-3 flex h-7 items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">
          {sel.count > 0 ? `${sel.count} selected` : "Folders"}
        </h2>
        {sel.count > 0 && (
          <Button variant="ghost" size="sm" onClick={sel.clear}>
            Cancel
          </Button>
        )}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-5 gap-y-7">
        {folders.map((f) => (
          <DiskFolderCard
            key={f.rel}
            slug={slug}
            folder={f}
            isSelected={sel.selected.has(f.rel)}
            onSelect={onSelect}
            onOpen={onOpen}
          />
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Update `folder-explorer.tsx`** — change the prop type to `FolderSummary[]`, pass `folders` to `FoldersSection`, and add `calendar` + `month` wiring. Full file:

```tsx
"use client";

import { catalogApiUrl, catalogPath } from "@/lib/catalog-api";
import { useCatalog } from "@/lib/catalog-context";
import { detailScopeQuery } from "@/lib/detail-scope";
import { PhotoLibraryView } from "@/components/photo-library/photo-library-view";
import type { FolderSummary } from "@/lib/catalog-fs-service";
import { FolderBreadcrumb } from "./folder-breadcrumb";
import { FoldersSection } from "./folders-section";

export function FolderExplorer({ rel, subfolders }: { rel: string; subfolders: FolderSummary[] }) {
  const { slug } = useCatalog();
  return (
    <PhotoLibraryView
      title={<FolderBreadcrumb slug={slug} rel={rel} />}
      aboveGrid={<FoldersSection slug={slug} folders={subfolders} />}
      calendar={{ facetsEndpoint: catalogApiUrl(slug, `/fs/calendar?path=${encodeURIComponent(rel)}`) }}
      collection={({ sort, month }) => {
        const q = detailScopeQuery({ kind: "folder", dir: rel, sort });
        return {
          endpoint: catalogApiUrl(slug, "/fs/photos"),
          params: new URLSearchParams(
            month ? { path: rel, sort, month } : { path: rel, sort },
          ),
          urlForId: (id) =>
            catalogPath(slug, q ? `/photo/${id}?${q}` : `/photo/${id}`),
          baseUrl: rel
            ? `${catalogPath(slug, "/folders")}?path=${encodeURIComponent(rel)}`
            : catalogPath(slug, "/folders"),
          key: `folder:${rel}:${sort}:${month ?? ""}`,
        };
      }}
    />
  );
}
```

- [ ] **Step 3: Update `page.tsx`** — call `listSubfolderSummaries`. Change the import line and the listing block:

Import:

```ts
import { listSubfolderSummaries, type FolderSummary } from "@/lib/catalog-fs-service";
```

Listing block:

```ts
  let subfolders: FolderSummary[];
  try {
    subfolders = await listSubfolderSummaries(catalog, rel);
  } catch {
    notFound(); // traversal escape or missing directory
  }
```

- [ ] **Step 4: Typecheck + lint the changed files**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: PASS (no new errors).

Run: `pnpm --filter @lumio/web exec eslint "src/app/(app)/c/[catalog]/folders/folders-section.tsx" "src/app/(app)/c/[catalog]/folders/folder-explorer.tsx" "src/app/(app)/c/[catalog]/folders/page.tsx" "src/app/(app)/c/[catalog]/folders/disk-folder-card.tsx"`
Expected: PASS (no errors; in particular no react-compiler refs-in-render or `"use client"` ordering warnings).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(app)/c/[catalog]/folders/folders-section.tsx" "apps/web/src/app/(app)/c/[catalog]/folders/folder-explorer.tsx" "apps/web/src/app/(app)/c/[catalog]/folders/page.tsx"
git commit -m "feat(web): /folders album-style cards, selection, calendar"
```

---

## Task 5: Cleanup dead code + full verification

**Files:**
- Modify: `apps/web/src/lib/catalog-fs-service.ts`
- Modify: `apps/web/src/lib/catalog-fs-service.test.ts`

`listSubfolders`/`Subfolder`/`SubfolderDeps`/`subfolderDeps` now have no callers (Task 4 switched everything to summaries).

- [ ] **Step 1: Confirm nothing still imports the old API**

Run: `grep -rn -e "\bSubfolder\b" -e "listSubfolders" apps/web/src | grep -v "catalog-fs-service"`
Expected: NO output (only the definitions remain).

- [ ] **Step 2: Remove the old function + types** from `apps/web/src/lib/catalog-fs-service.ts` — delete the `Subfolder` interface, the `SubfolderDeps` interface, the `subfolderDeps` const, and the `listSubfolders` function. Keep `FolderSummary`, `subtreeWhere`, `FolderSummaryDeps`, `folderSummaryDeps`, `listSubfolderSummaries`, and all imports they use.

- [ ] **Step 3: Remove the old tests** from `apps/web/src/lib/catalog-fs-service.test.ts` — delete the `describe("listSubfolders", …)` block and the now-unused `listSubfolders, type SubfolderDeps` import. Keep the `subtreeWhere` + `listSubfolderSummaries` describes.

- [ ] **Step 4: Run the package tests**

Run: `pnpm --filter @lumio/web test`
Expected: PASS (no reference to the removed `listSubfolders`; new folder tests green).

- [ ] **Step 5: Full gates**

Run: `pnpm -r test`
Expected: PASS (whole monorepo).

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: PASS, except any PRE-EXISTING errors in `apps/web/src/lib/calendar.ts` (a known, unrelated baseline — confirm no NEW errors elsewhere).

Run: `pnpm --filter @lumio/web exec eslint src`
Expected: PASS.

Run: `pnpm --filter @lumio/web build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/catalog-fs-service.ts apps/web/src/lib/catalog-fs-service.test.ts
git commit -m "refactor(web): drop unused listSubfolders/Subfolder"
```

- [ ] **Step 7: Browser verification** (dev server already runs; use the disk-explorer-enabled catalog)

Navigate to `/c/<catalog>/folders` and confirm:
- Folder cards show a 2×2 cover mosaic (folder icon when a subfolder has no photos) + name + "{n} folders · {m} photos" subtitle.
- Single click selects one (blue ring); ⌘/Ctrl click toggles into a multi-selection; shift click extends a range. Inline "N selected · Cancel" appears above the cards; Cancel and Escape clear it.
- Double click a card opens it (navigates into the subfolder); middle click opens in a new tab.
- The photo grid below is the folder's DIRECT photos and is unaffected by folder selection; the photo bulk toolbar + lightbox still work.
- The calendar menu appears in the header; picking a month filters the photo grid; clearing restores it.

---

## Self-Review (completed)

**Spec coverage:**
- §A folder summaries → Task 1 (`listSubfolderSummaries`, `subtreeWhere`, recursive count/previews, fs subfolderCount, traversal guard, injectable deps). ✓
- §B card + section (mosaic, subtitle, ring, click/⌘/shift, double-click/Enter via native link, responsive grid, no context menu) → Tasks 3 + 4. ✓
- §C page composition (PhotoLibraryView + aboveGrid + collection key/month) → Task 4. ✓
- §D calendar (direct `/fs/calendar`, month on `/fs/photos`, direct not recursive) → Task 2 + Task 4. ✓
- §E cleanup (rename listSubfolders→summaries, no PhotoLibraryView change) → Tasks 1/4/5. ✓
- §F testing (unit for summaries + subtitle; browser checks; gates) → Tasks 1, 3, 5. ✓
- §G deferred (no rename/move/delete, no density, no header-takeover) → honored; FoldersSection has no action buttons, fixed grid, inline bar. ✓

**Type consistency:** `FolderSummary { name, rel, subfolderCount, photoCount, previewPhotoIds }` defined in Task 1 and consumed identically in Tasks 3 (`DiskFolderCard`) and 4 (`FoldersSection`/`folder-explorer`/`page`). `subtreeWhere(catalogId, rel)`, `folderSubtitle(subfolderCount, photoCount)`, `listSubfolderSummaries(catalog, rel, deps?)` signatures are stable across tasks.

**Deviation from spec (intentional, noted):** §A's preview strategy is per-subfolder parallel `findMany(take:4)` rather than one bucketed windowed query — the windowed approach can starve covers for folders whose newest photo falls outside the window; the per-subfolder query is correct and still bounded/parallel. §B's `useGridSelectionNav` is narrowed to `useGridSelection` + `computeSelection` to avoid a global arrow-key listener fighting the photo grid below (documented in Task 4).
