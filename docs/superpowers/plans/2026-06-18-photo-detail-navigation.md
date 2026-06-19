# Photo Detail Navigation (Arrows + Film Strip) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users step through photos in the detail view via left/right arrows over the image and a film strip of thumbnails beneath it, scoped to the album they came from or the whole library.

**Architecture:** Navigation is route changes (`/photo/{id}?album={albumId}`), not client state — each detail render computes its own neighbors server-side via Prisma keyset cursoring, so the modal and standalone page behave identically. The grid threads its album context into tile links; the detail pages read it from `searchParams`.

**Tech Stack:** Next.js App Router (server components + intercepted routes), Prisma (compound-order cursor pagination), React client components, Tailwind, lucide-react, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-18-photo-detail-navigation-design.md`

---

## File structure

- `packages/shared/src/types.ts` — add `PhotoStripItem`, `PhotoNeighbors` types (modify).
- `apps/web/src/lib/photo-href.ts` — **new**, pure `photoHref(id, albumId)` helper (the single `?album=` rule, shared by grid + detail).
- `apps/web/src/lib/photo-href.test.ts` — **new**, unit test for the helper.
- `apps/web/src/lib/albums-service.ts` — export `albumPhotoWhere(albumId, db)` (modify).
- `apps/web/src/lib/albums-service.test.ts` — tests for `albumPhotoWhere` (modify).
- `apps/web/src/lib/photos-service.ts` — add `getPhotoNeighbors(current, albumId, window, db)` (modify).
- `apps/web/src/lib/photos-service.test.ts` — tests for `getPhotoNeighbors` (modify).
- `apps/web/src/lib/photo-detail-loader.ts` — **new**, server helper shared by both detail pages.
- `apps/web/src/app/(app)/photo/[id]/film-strip.tsx` — **new**, isolated client strip component.
- `apps/web/src/app/(app)/photo/[id]/photo-detail.tsx` — vertical image column, arrows, keyboard nav, render `FilmStrip` (modify).
- `apps/web/src/app/(app)/photo/[id]/page.tsx` — read `searchParams`, use loader, pass props (modify).
- `apps/web/src/app/(app)/@modal/(.)photo/[id]/page.tsx` — same (modify).
- `apps/web/src/app/(app)/photos/photo-grid.tsx` — `albumId?` prop + context-aware tile href (modify).
- `apps/web/src/app/(app)/albums/[id]/album-view.tsx` — pass `albumId` to the grid (modify).

Run tests with `pnpm --filter @lumio/web test` (Vitest, `vitest run`). Shared package: `pnpm --filter @lumio/shared build` after type changes so `@lumio/shared` consumers see them.

---

## Task 1: Shared types for the strip and neighbors

**Files:**
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: Add the types**

Append to `packages/shared/src/types.ts` (after the `PhotoDTO` interface):

```ts
/** Minimal photo shape for the film strip — just enough to render a thumbnail. */
export interface PhotoStripItem {
  id: string;
  path: string;
}

/** Neighbors of a photo within a navigation scope (album or whole library). */
export interface PhotoNeighbors {
  /** Photo one position earlier in PHOTO_ORDER (the left arrow target); null at the start. */
  prevId: string | null;
  /** Photo one position later in PHOTO_ORDER (the right arrow target); null at the end. */
  nextId: string | null;
  /** A window of strip items in PHOTO_ORDER: [...before, current, ...after]. */
  strip: PhotoStripItem[];
}
```

- [ ] **Step 2: Build the shared package so consumers see the types**

Run: `pnpm --filter @lumio/shared build`
Expected: builds with no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): PhotoStripItem and PhotoNeighbors types"
```

---

## Task 2: `photoHref` helper

The single rule for building a photo route URL with optional album context, shared by the grid tiles, the arrows, the film strip, and keyboard nav.

**Files:**
- Create: `apps/web/src/lib/photo-href.ts`
- Test: `apps/web/src/lib/photo-href.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/photo-href.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { photoHref } from "./photo-href.js";

describe("photoHref", () => {
  it("returns a plain path with no album context", () => {
    expect(photoHref("abc")).toBe("/photo/abc");
    expect(photoHref("abc", null)).toBe("/photo/abc");
  });

  it("appends the album id as a query param when present", () => {
    expect(photoHref("abc", "alb1")).toBe("/photo/abc?album=alb1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/web test -- photo-href`
Expected: FAIL — cannot find module `./photo-href.js`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/lib/photo-href.ts`:

```ts
/**
 * URL for a photo's detail route, carrying the navigation scope. When an album
 * id is present, neighbors/film-strip navigate within that album; otherwise the
 * whole library. This is the one place the `?album=` convention is defined.
 */
export function photoHref(id: string, albumId?: string | null): string {
  return albumId ? `/photo/${id}?album=${encodeURIComponent(albumId)}` : `/photo/${id}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/web test -- photo-href`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/photo-href.ts apps/web/src/lib/photo-href.test.ts
git commit -m "feat(web): photoHref helper for album-scoped photo routes"
```

---

## Task 3: `albumPhotoWhere` helper in albums-service

Extract the album → Prisma `where` logic (regular + smart) so the neighbor query can reuse it. The existing `listAlbumPhotos` keeps working but will read more clearly if it reuses the helper too.

**Files:**
- Modify: `apps/web/src/lib/albums-service.ts`
- Test: `apps/web/src/lib/albums-service.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/lib/albums-service.test.ts` (it already imports from `./albums-service.js` and defines `albumRow`). Add `albumPhotoWhere` to the import list and append:

```ts
describe("albumPhotoWhere", () => {
  it("returns a membership where for a regular album", async () => {
    const db = { album: { findUnique: async () => albumRow({ id: "alb1", isSmart: false }) } };
    const where = await albumPhotoWhere("alb1", db as never);
    expect(where).toEqual({ albums: { some: { albumId: "alb1" } } });
  });

  it("returns null for a missing album", async () => {
    const db = { album: { findUnique: async () => null } };
    const where = await albumPhotoWhere("nope", db as never);
    expect(where).toBeNull();
  });

  it("returns a smart-album where (not a membership clause)", async () => {
    const rules = { match: "all", rules: [{ field: "exif.cameraModel", op: "eq", value: "X" }] };
    const db = {
      album: { findUnique: async () => albumRow({ id: "s1", isSmart: true, rules }) },
    };
    const where = await albumPhotoWhere("s1", db as never);
    // Smart albums filter on photo fields, never on album membership.
    expect(where).not.toBeNull();
    expect((where as Record<string, unknown>).albums).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/web test -- albums-service`
Expected: FAIL — `albumPhotoWhere` is not exported.

- [ ] **Step 3: Implement the helper and reuse it in `listAlbumPhotos`**

In `apps/web/src/lib/albums-service.ts`, add the `Prisma` type to the existing `@lumio/db` import:

```ts
import { type Prisma, type PrismaClient, prisma, smartAlbumWhere, toAlbumDTO, toPhotoDTO } from "@lumio/db";
```

Add the exported helper (place it just above `listAlbumPhotos`):

```ts
/**
 * Prisma `where` selecting the photos in an album's navigation scope: explicit
 * membership for a regular album, or the smart-album rule predicate for a smart
 * one. Returns null when the album does not exist.
 */
export async function albumPhotoWhere(
  albumId: string,
  db: Pick<PrismaClient, "album"> = prisma,
): Promise<Prisma.PhotoWhereInput | null> {
  const album = await db.album.findUnique({ where: { id: albumId } });
  if (!album) return null;
  const dto = toAlbumDTO(album);
  return dto.isSmart
    ? smartAlbumWhere(dto.rules as SmartAlbumRules, new Date())
    : { albums: { some: { albumId } } };
}
```

Then simplify `listAlbumPhotos` to reuse it — replace its album-load + where block:

```ts
export async function listAlbumPhotos(
  id: string,
  params: PhotosQuery,
  db: Db = prisma,
): Promise<PhotosPage | null> {
  const where = await albumPhotoWhere(id, db);
  if (where === null) return null;
  const { limit, cursor } = params;
  const rows = await db.photo.findMany({
    where,
    take: limit,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    orderBy: PHOTO_ORDER,
  });
  const nextCursor = rows.length === limit ? (rows[rows.length - 1]?.id ?? null) : null;
  return { items: rows.map(toPhotoDTO), nextCursor };
}
```

Note: `Db` already includes `"album"` (`Pick<PrismaClient, "album" | "albumPhoto" | "photo">`), so passing `db` to `albumPhotoWhere` typechecks.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @lumio/web test -- albums-service`
Expected: PASS — new `albumPhotoWhere` tests plus the existing `listAlbumPhotos` tests still green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/albums-service.ts apps/web/src/lib/albums-service.test.ts
git commit -m "refactor(web): extract albumPhotoWhere; reuse in listAlbumPhotos"
```

---

## Task 4: `getPhotoNeighbors` in photos-service

**Files:**
- Modify: `apps/web/src/lib/photos-service.ts`
- Test: `apps/web/src/lib/photos-service.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/lib/photos-service.test.ts`. Add `getPhotoNeighbors` to the import from `./photos-service.js`, then append. The fake DB below simulates Prisma keyset semantics (cursor + `skip: 1` + positive/negative `take`) over a list already in `PHOTO_ORDER`:

```ts
// Simulates Prisma cursor pagination over an array that is already in PHOTO_ORDER.
// Positive take = rows after the cursor; negative take = rows before it (returned
// in array order, matching Prisma's "paginate backwards").
function keysetDb(ordered: Array<{ id: string; path: string }>) {
  return {
    photo: {
      findMany: async (args: { cursor: { id: string }; skip: number; take: number }) => {
        const idx = ordered.findIndex((r) => r.id === args.cursor.id);
        if (idx === -1) return [];
        if (args.take >= 0) {
          return ordered.slice(idx + args.skip, idx + args.skip + args.take);
        }
        const end = idx; // skip:1 excludes the cursor itself
        return ordered.slice(Math.max(0, end + args.take), end);
      },
    },
  };
}

const strip = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, path: `p${i}.jpg` }));

describe("getPhotoNeighbors", () => {
  it("returns the immediate prev/next and a centered strip (library scope)", async () => {
    const ordered = strip(5); // p0 (newest) .. p4 (oldest), already in PHOTO_ORDER
    const db = keysetDb(ordered);
    const n = await getPhotoNeighbors({ id: "p2", path: "p2.jpg" }, null, 10, db as never);
    expect(n.prevId).toBe("p1");
    expect(n.nextId).toBe("p3");
    expect(n.strip.map((s) => s.id)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
  });

  it("nulls prevId at the start and nextId at the end", async () => {
    const ordered = strip(3);
    const db = keysetDb(ordered);
    const first = await getPhotoNeighbors({ id: "p0", path: "p0.jpg" }, null, 10, db as never);
    expect(first.prevId).toBeNull();
    expect(first.nextId).toBe("p1");
    const last = await getPhotoNeighbors({ id: "p2", path: "p2.jpg" }, null, 10, db as never);
    expect(last.prevId).toBe("p1");
    expect(last.nextId).toBeNull();
  });

  it("clamps the window near an edge", async () => {
    const ordered = strip(10);
    const db = keysetDb(ordered);
    const n = await getPhotoNeighbors({ id: "p1", path: "p1.jpg" }, null, 2, db as never);
    // window=2: before is clamped to [p0], after is [p2, p3]
    expect(n.strip.map((s) => s.id)).toEqual(["p0", "p1", "p2", "p3"]);
    expect(n.prevId).toBe("p0");
    expect(n.nextId).toBe("p2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/web test -- photos-service`
Expected: FAIL — `getPhotoNeighbors` is not exported.

- [ ] **Step 3: Implement `getPhotoNeighbors`**

In `apps/web/src/lib/photos-service.ts`:

Update imports — add `getPhoto` context types and the album-where helper:

```ts
import { type PrismaClient, prisma, toPhotoDTO } from "@lumio/db";
import type { PhotoNeighbors, PhotosPage, PhotosQuery, PhotoStripItem } from "@lumio/shared";
import { albumPhotoWhere } from "@/lib/albums-service";
import { CACHE_DIR, PHOTOS_DIR } from "@/lib/paths";
```

Widen the local `Db` type to allow building the album where-clause:

```ts
type Db = Pick<PrismaClient, "photo" | "album">;
```

Add the constant (matches the ordering used everywhere) and the function:

```ts
const PHOTO_ORDER = [{ sortDate: "desc" as const }, { id: "desc" as const }];

/**
 * Neighbors of `current` within a navigation scope, for the detail view's arrows
 * and film strip. `albumId` null = whole library; otherwise the album's photos
 * (regular or smart). Uses keyset cursoring on the current id over PHOTO_ORDER:
 * a forward page (next) and a backward page (prev, negative take). Both come back
 * in PHOTO_ORDER, so `before` ends with the nearest-prev and `strip` reads
 * left-to-right as the grid does. Selects only id+path to keep the window cheap.
 */
export async function getPhotoNeighbors(
  current: PhotoStripItem,
  albumId: string | null,
  window = 25,
  db: Db = prisma,
): Promise<PhotoNeighbors> {
  const where = albumId ? await albumPhotoWhere(albumId, db) : {};
  if (where === null) {
    // Album no longer exists — degrade to no navigation rather than throwing.
    return { prevId: null, nextId: null, strip: [current] };
  }
  const select = { id: true, path: true } as const;
  const [before, after] = await Promise.all([
    db.photo.findMany({
      where,
      cursor: { id: current.id },
      skip: 1,
      take: -window,
      orderBy: PHOTO_ORDER,
      select,
    }),
    db.photo.findMany({
      where,
      cursor: { id: current.id },
      skip: 1,
      take: window,
      orderBy: PHOTO_ORDER,
      select,
    }),
  ]);
  return {
    prevId: before.at(-1)?.id ?? null,
    nextId: after[0]?.id ?? null,
    strip: [...before, current, ...after],
  };
}
```

Note: `albumPhotoWhere(albumId, db)` receives the widened `db` (now includes `"album"`). The library-scope tests use a fake with only `photo.findMany`, which is exactly the path exercised when `albumId` is null.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @lumio/web test -- photos-service`
Expected: PASS — the three `getPhotoNeighbors` tests plus the existing `listPhotos`/`purgeAllPhotos` tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/photos-service.ts apps/web/src/lib/photos-service.test.ts
git commit -m "feat(web): getPhotoNeighbors keyset query for detail navigation"
```

---

## Task 5: Shared `loadPhotoDetail` server helper

Both detail pages fetch the same trio; factor it so they can't drift.

**Files:**
- Create: `apps/web/src/lib/photo-detail-loader.ts`

- [ ] **Step 1: Write the loader**

Create `apps/web/src/lib/photo-detail-loader.ts`:

```ts
import { listAlbumSummaries } from "@/lib/albums-service";
import { getPhoto, getPhotoNeighbors } from "@/lib/photos-service";

export interface PhotoDetailData {
  photo: NonNullable<Awaited<ReturnType<typeof getPhoto>>>;
  regularAlbums: Awaited<ReturnType<typeof listAlbumSummaries>>;
  neighbors: Awaited<ReturnType<typeof getPhotoNeighbors>>;
}

/**
 * Loads everything the detail view needs: the photo, the regular albums (for the
 * membership checkboxes), and the prev/next + film-strip neighbors scoped by
 * `albumId` (null = whole library). Returns null when the photo is missing so
 * callers can `notFound()`.
 */
export async function loadPhotoDetail(
  id: string,
  albumId: string | null,
): Promise<PhotoDetailData | null> {
  const photo = await getPhoto(id);
  if (!photo) return null;
  const [albums, neighbors] = await Promise.all([
    listAlbumSummaries(),
    getPhotoNeighbors({ id: photo.id, path: photo.path }, albumId),
  ]);
  return {
    photo,
    regularAlbums: albums.filter((a) => !a.isSmart),
    neighbors,
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: no errors from this file (other untouched files unaffected).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/photo-detail-loader.ts
git commit -m "feat(web): loadPhotoDetail shared server loader"
```

---

## Task 6: `FilmStrip` client component

**Files:**
- Create: `apps/web/src/app/(app)/photo/[id]/film-strip.tsx`

- [ ] **Step 1: Write the component**

Create `apps/web/src/app/(app)/photo/[id]/film-strip.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import type { PhotoStripItem } from "@lumio/shared";
import { cn } from "@/lib/utils";

/**
 * Horizontal strip of thumbnails for the detail view. The active thumbnail is
 * highlighted and re-centered (by scrolling only the strip container, never the
 * window) whenever the current photo changes — arrow keys, arrow buttons, and
 * thumbnail clicks all land here. Thumbnails are links; prefetch is off so we
 * don't prefetch ~50 routes at once (the prev/next arrows keep prefetch).
 */
export function FilmStrip({
  items,
  currentId,
  hrefFor,
}: {
  items: PhotoStripItem[];
  currentId: string;
  hrefFor: (id: string) => string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const el = currentRef.current;
    if (!container || !el) return;
    const left = el.offsetLeft - container.clientWidth / 2 + el.clientWidth / 2;
    container.scrollTo({ left });
  }, [currentId]);

  return (
    <div
      ref={containerRef}
      className="flex shrink-0 gap-1 overflow-x-auto border-t bg-background/40 p-2"
    >
      {items.map((item) => {
        const active = item.id === currentId;
        return (
          <Link
            key={item.id}
            ref={active ? currentRef : undefined}
            href={hrefFor(item.id)}
            prefetch={false}
            aria-current={active ? "true" : undefined}
            className={cn(
              "block size-14 shrink-0 overflow-hidden rounded-sm outline-none ring-offset-2 ring-offset-background transition",
              active
                ? "ring-2 ring-primary"
                : "opacity-60 hover:opacity-100",
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/thumbnails/${item.id}`}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          </Link>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Lint the new file**

Run: `pnpm --filter @lumio/web lint`
Expected: no errors for `film-strip.tsx`.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(app)/photo/[id]/film-strip.tsx"
git commit -m "feat(web): FilmStrip thumbnail rail for the photo detail view"
```

---

## Task 7: Arrows, keyboard nav, and layout in `PhotoDetail`

**Files:**
- Modify: `apps/web/src/app/(app)/photo/[id]/photo-detail.tsx`

- [ ] **Step 1: Rewrite the `PhotoDetail` component (top of the file)**

Replace the imports and the `PhotoDetail` function. Keep `AlbumMembership` and `Row` (below) exactly as they are.

New imports block at the top of the file:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { AlbumSummaryDTO, PhotoDTO, PhotoNeighbors } from "@lumio/shared";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { photoHref } from "@/lib/photo-href";
import { FilmStrip } from "./film-strip";
```

New `PhotoDetail` function (replaces the current one):

```tsx
export function PhotoDetail({
  photo,
  regularAlbums,
  neighbors,
  albumId,
}: {
  photo: PhotoDTO;
  regularAlbums: AlbumSummaryDTO[];
  neighbors: PhotoNeighbors;
  albumId: string | null;
}) {
  const router = useRouter();
  const filename = photo.path.split("/").pop() || photo.path;
  const camera =
    [photo.exif.cameraMake, photo.exif.cameraModel].filter(Boolean).join(" ") ||
    "—";

  const prevHref = neighbors.prevId ? photoHref(neighbors.prevId, albumId) : null;
  const nextHref = neighbors.nextId ? photoHref(neighbors.nextId, albumId) : null;

  // Arrow-key navigation. Lives here (not in RouteOverlay) so it works on the
  // standalone page as well as in the modal. Ignore keys while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft" && prevHref) router.push(prevHref);
      if (e.key === "ArrowRight" && nextHref) router.push(nextHref);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [prevHref, nextHref, router]);

  // The layout fills its container edge to edge (full viewport height, padding
  // owned by each side rather than an outer frame), so the standalone page and
  // the modal overlay look identical. The image side has no background of its
  // own: on the standalone page it shows the opaque body behind it; inside the
  // intercepted-route overlay it shows that overlay's frosted-glass material,
  // which is what makes only the image side read as translucent in the modal.
  return (
    <div className="flex flex-col lg:h-dvh lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative flex min-h-0 flex-1 items-center justify-center p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/photos/${photo.id}/display`}
            alt={photo.path}
            className="max-h-[80vh] w-full object-contain lg:max-h-full lg:w-auto lg:max-w-full"
          />
          {prevHref && <NavArrow side="left" href={prevHref} label="Previous photo" />}
          {nextHref && <NavArrow side="right" href={nextHref} label="Next photo" />}
        </div>
        {neighbors.strip.length > 1 && (
          <FilmStrip
            items={neighbors.strip}
            currentId={photo.id}
            hrefFor={(id) => photoHref(id, albumId)}
          />
        )}
      </div>
      <aside className="w-full shrink-0 border-t bg-background p-4 text-sm lg:h-dvh lg:w-80 lg:overflow-y-auto lg:border-t-0 lg:border-l">
        <div className="space-y-1">
          <h2 className="font-medium break-all">{filename}</h2>
          <div className="flex items-center gap-2">
            <Badge>{photo.source}</Badge>
            <span className="text-muted-foreground">
              {photo.width}×{photo.height}
            </span>
          </div>
        </div>

        <Separator className="my-4" />

        <div className="space-y-3">
          <Row label="Taken" value={photo.takenAt ?? "—"} />
          <Row label="Camera" value={camera} />
          <Row label="Hash" value={photo.hash ?? "—"} />
        </div>

        {regularAlbums.length > 0 && (
          <>
            <Separator className="my-4" />
            <AlbumMembership photo={photo} regularAlbums={regularAlbums} />
          </>
        )}

        <Separator className="my-4" />

        <details className="group">
          <summary className="cursor-pointer text-muted-foreground select-none">
            Show all EXIF
          </summary>
          <pre className="mt-2 overflow-auto rounded bg-muted p-2 text-xs">
            {JSON.stringify(photo.exif, null, 2)}
          </pre>
        </details>
      </aside>
    </div>
  );
}

function NavArrow({
  side,
  href,
  label,
}: {
  side: "left" | "right";
  href: string;
  label: string;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <Link
      href={href}
      aria-label={label}
      className={cn(
        "absolute top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/70 text-foreground shadow-sm backdrop-blur transition hover:bg-background",
        side === "left" ? "left-2" : "right-2",
      )}
    >
      <Icon className="size-6" />
    </Link>
  );
}
```

Leave the existing `AlbumMembership` and `Row` functions unchanged below this.

- [ ] **Step 2: Lint + typecheck**

Run: `pnpm --filter @lumio/web lint && pnpm --filter @lumio/web exec tsc --noEmit`
Expected: no errors. (Type errors in the two `page.tsx` files are expected until Task 8 — if `tsc` flags them, that's fine; proceed.)

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(app)/photo/[id]/photo-detail.tsx"
git commit -m "feat(web): overlay nav arrows, arrow-key nav, and film strip in PhotoDetail"
```

---

## Task 8: Wire both detail pages to the loader + searchParams

**Files:**
- Modify: `apps/web/src/app/(app)/photo/[id]/page.tsx`
- Modify: `apps/web/src/app/(app)/@modal/(.)photo/[id]/page.tsx`

- [ ] **Step 1: Rewrite the standalone page**

Replace `apps/web/src/app/(app)/photo/[id]/page.tsx` with:

```tsx
import { notFound } from "next/navigation";
import { loadPhotoDetail } from "@/lib/photo-detail-loader";
import { PhotoDetail } from "./photo-detail";

export const dynamic = "force-dynamic";

export default async function PhotoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ album?: string }>;
}) {
  const { id } = await params;
  const { album } = await searchParams;
  const data = await loadPhotoDetail(id, album ?? null);
  if (!data) notFound();

  return (
    <main>
      <PhotoDetail
        photo={data.photo}
        regularAlbums={data.regularAlbums}
        neighbors={data.neighbors}
        albumId={album ?? null}
      />
    </main>
  );
}
```

- [ ] **Step 2: Rewrite the intercepted modal page**

Replace `apps/web/src/app/(app)/@modal/(.)photo/[id]/page.tsx` with:

```tsx
import { notFound } from "next/navigation";
import { RouteOverlay } from "@/components/route-overlay";
import { loadPhotoDetail } from "@/lib/photo-detail-loader";
import { PhotoDetail } from "@/app/(app)/photo/[id]/photo-detail";

export const dynamic = "force-dynamic";

export default async function PhotoIntercept({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ album?: string }>;
}) {
  const { id } = await params;
  const { album } = await searchParams;
  const data = await loadPhotoDetail(id, album ?? null);
  if (!data) notFound();

  return (
    <RouteOverlay>
      <PhotoDetail
        photo={data.photo}
        regularAlbums={data.regularAlbums}
        neighbors={data.neighbors}
        albumId={album ?? null}
      />
    </RouteOverlay>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: no errors (PhotoDetail's new props are now satisfied by both pages).

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(app)/photo/[id]/page.tsx" "apps/web/src/app/(app)/@modal/(.)photo/[id]/page.tsx"
git commit -m "feat(web): load neighbors + album scope into both photo detail pages"
```

---

## Task 9: Thread album context from the grid into tile links

**Files:**
- Modify: `apps/web/src/app/(app)/photos/photo-grid.tsx`
- Modify: `apps/web/src/app/(app)/albums/[id]/album-view.tsx`

- [ ] **Step 1: Add `albumId` to `PhotoGrid` and use `photoHref` for tiles**

In `apps/web/src/app/(app)/photos/photo-grid.tsx`:

Add the import near the other `@/lib` imports:

```tsx
import { photoHref } from "@/lib/photo-href";
```

Add `albumId` to the props type and destructuring:

```tsx
export function PhotoGrid({
  endpoint = "/api/photos",
  albumId,
  empty = PHOTOS_EMPTY,
  selectMode = false,
  selectedIds,
  onSelectionChange,
}: {
  endpoint?: string;
  albumId?: string;
  empty?: React.ReactNode;
  selectMode?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
}) {
```

Change the tile link's `href` (currently `href={`/photo/${photo.id}`}`):

```tsx
                return (
                  <Link
                    key={photo.id}
                    href={photoHref(photo.id, albumId)}
                    className="block h-full outline-none focus:outline-none focus-visible:outline-none"
                  >
                    {thumb}
                  </Link>
                );
```

- [ ] **Step 2: Pass `albumId` from the album view**

In `apps/web/src/app/(app)/albums/[id]/album-view.tsx`, add `albumId` to the `<PhotoGrid>` usage (it already has `endpoint={`/api/albums/${albumId}/photos`}`):

```tsx
      <PhotoGrid
        key={reloadKey}
        endpoint={`/api/albums/${albumId}/photos`}
        albumId={albumId}
        selectMode={sel.selectMode}
        selectedIds={sel.selected}
        onSelectionChange={sel.setSelected}
        empty={
```

The library view (`apps/web/src/app/(app)/photos/library-view.tsx`) passes no `albumId`, so library tiles stay plain `/photo/{id}` — correct.

- [ ] **Step 3: Lint + typecheck**

Run: `pnpm --filter @lumio/web lint && pnpm --filter @lumio/web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(app)/photos/photo-grid.tsx" "apps/web/src/app/(app)/albums/[id]/album-view.tsx"
git commit -m "feat(web): carry album context from grid tiles into photo routes"
```

---

## Task 10: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the web test suite**

Run: `pnpm --filter @lumio/web test`
Expected: all pass, including the new `photo-href`, `albumPhotoWhere`, and `getPhotoNeighbors` tests.

- [ ] **Step 2: Lint + typecheck the whole web app**

Run: `pnpm --filter @lumio/web lint && pnpm --filter @lumio/web exec tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Browser verification (manual)**

Start the app (`pnpm --filter @lumio/web dev`, DB on 5433) and verify:

1. **Library, mid-grid photo:** open a photo from the middle of `/photos`. Both arrows show; clicking ▶ / pressing `→` advances one photo; ◀ / `←` goes back. The film strip highlights the current photo and re-centers on each move; clicking a thumbnail jumps to it.
2. **Ends:** open the very first photo → no ◀; open the last → no ▶.
3. **Album scope:** open `/albums/{id}`, open a photo. The URL carries `?album={id}`; arrows and strip stay **within** the album; strip length matches the album. Verify with a **smart** album too.
4. **Modal vs standalone:** navigating from the grid opens the modal overlay; arrows/strip/keys work there; `Esc` and browser back return to the grid at its prior scroll position. Loading `/photo/{id}` directly (standalone) behaves the same.
5. **Single photo:** in a scope with one photo, no arrows and no strip render.

- [ ] **Step 4: Final commit (only if verification surfaced fixes)**

```bash
git add -A
git commit -m "fix(web): photo detail navigation adjustments from verification"
```

---

## Self-review notes

- **Spec coverage:** scope decision (Task 9 + page wiring), `getPhotoNeighbors` keyset query (Task 4), `albumPhotoWhere` smart-album reuse (Task 3), arrows + hide-at-ends + keyboard (Task 7), film strip + auto-center + prefetch off (Task 6), shared loader (Task 5), types (Task 1), `photoHref` rule (Task 2). All spec sections map to a task.
- **Type consistency:** `PhotoStripItem`/`PhotoNeighbors` (Task 1) are consumed unchanged by `getPhotoNeighbors` (Task 4), `FilmStrip` (Task 6), `PhotoDetail` (Task 7), and `loadPhotoDetail` (Task 5). `photoHref(id, albumId?)` signature is identical across Tasks 2, 6, 7, 9. `albumPhotoWhere(albumId, db)` returns `Prisma.PhotoWhereInput | null` consumed in Tasks 3 and 4.
- **Assumption:** Prisma negative-`take` backward pagination returns rows in `orderBy` order — the unit tests model this and the existing forward-cursor path proves the compound-order cursor works; browser verification (Task 10) confirms against the real DB.
