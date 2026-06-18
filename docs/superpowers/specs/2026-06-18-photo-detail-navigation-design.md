# Photo detail navigation — arrows + film strip — design

**Date:** 2026-06-18
**Status:** Approved (pending user spec review)

## Problem

The photo detail view (`/photo/[id]`, standalone and as the intercepting modal
overlay) shows a single image with an info pane. There's no way to move to the
next/previous photo without backing out to the grid. We want to browse photos
in place: **left/right navigation arrows over the image** and a **film strip of
thumbnails** beneath it, so you can step through or jump around the set.

## Navigation scope (decided)

**Context-aware (B).** When a photo is opened from inside an album, prev/next and
the film strip walk that album's photos; otherwise they walk the whole library.
The two grids (library and album) already share one `PhotoGrid` and one ordering
(`PHOTO_ORDER` = `sortDate desc, id desc`), so "neighbors" is well-defined in
both scopes.

## Approach

**Navigation is route changes, not client state.** The arrows and film-strip
thumbnails are links to sibling photo routes (`/photo/{id}` or
`/photo/{id}?album={albumId}`). Each detail render computes its own neighbors
server-side. This works identically in the modal and the standalone page, needs
no shared client list, and reuses the existing soft-nav + Esc/back behavior
(the grid stays mounted underneath and is restored on exit).

*Rejected alternative:* pass the grid's already-loaded photo array into the
detail via React context. Fails because the intercepted modal is a **separate
server render** that does not share the grid's client state; it would also break
the standalone page entirely.

**Context travels in the URL.** `PhotoGrid` gains an optional `albumId` prop.
`AlbumView` passes its id; the library view does not. Tile links become
`/photo/{id}?album={albumId}` inside an album and plain `/photo/{id}` in the
library. Both detail `page.tsx` files read `searchParams.album` and scope
neighbor lookups accordingly.

## Design

### Data layer — `getPhotoNeighbors`

A new server function returns the window of photos around the current one:

```ts
interface PhotoStripItem { id: string; path: string }
interface PhotoNeighbors {
  prevId: string | null;   // photo to the left  (one position earlier in PHOTO_ORDER)
  nextId: string | null;   // photo to the right (one position later)
  strip: PhotoStripItem[]; // [...before, current, ...after] in PHOTO_ORDER
}

getPhotoNeighbors(
  photoId: string,
  albumId: string | null,
  window = 25,            // photos fetched on each side
  db = prisma,
): Promise<PhotoNeighbors>
```

Implementation:

- Resolve the Prisma `where` for the scope. `albumId === null` → `{}` (whole
  library). Otherwise reuse the album where-logic, **including smart albums**, by
  exporting a helper `albumPhotoWhere(albumId, db): Promise<Where | null>` from
  `albums-service.ts` (it already builds `smartAlbumWhere(...)` vs.
  `{ albums: { some: { albumId } } }`). Returns `null` if the album is missing.
- Two keyset queries over `PHOTO_ORDER`, cursored on the current id:
  - `before` = `findMany({ where, cursor: { id: photoId }, skip: 1, take: -window, orderBy: PHOTO_ORDER, select: { id, path } })`
  - `after`  = `findMany({ where, cursor: { id: photoId }, skip: 1, take:  window, orderBy: PHOTO_ORDER, select: { id, path } })`
  - This mirrors the existing forward-cursor pagination already used by
    `listPhotos` / `listAlbumPhotos` (same compound order, `id` unique). Negative
    `take` paginates backward from the cursor; Prisma returns both arrays in
    `PHOTO_ORDER`, so `before` is `[…older-prev, nearest-prev]`.
- `prevId = before.at(-1)?.id ?? null` (nearest photo to the left),
  `nextId = after[0]?.id ?? null`.
- `strip = [...before, { id, path } /* current */, ...after]`.
- Where to put it: add `getPhotoNeighbors` to `photos-service.ts`, importing
  `albumPhotoWhere` from `albums-service.ts` (keeps smart-album logic in one
  place). `PhotoStripItem` / `PhotoNeighbors` go in `packages/shared/src/types.ts`.

Cost note: selecting only `id, path` keeps the ~51-row window cheap (no EXIF
JSON). Thumbnails reuse the cached-webp `/api/thumbnails/{id}` endpoint.

### Page wiring

Both `page.tsx` files (`photo/[id]` and `@modal/(.)photo/[id]`) are nearly
identical; factor the shared load into one helper to avoid drift:

```ts
// loadPhotoDetail(id, albumId) -> { photo, regularAlbums, neighbors } | null
```

Each page reads `searchParams` (`{ album?: string }`), calls the helper, and
passes `neighbors` plus the nav context (`albumId`) into `PhotoDetail`. The
interceptor matches on path, so the `?album=` query passes straight through as
`searchParams`.

### `PhotoDetail` — layout & interactions

The left column becomes vertical: **image area on top (`flex-1`), film strip
pinned at its bottom.** The info `<aside>` is unchanged.

```
<div className="flex flex-col lg:h-dvh lg:flex-row">
  <div className="flex min-w-0 flex-1 flex-col">     {/* image column */}
    <div className="relative flex-1 …center…">
      <img … />
      {prevHref && <NavArrow side="left"  href={prevHref} />}
      {nextHref && <NavArrow side="right" href={nextHref} />}
    </div>
    {strip.length > 1 && <FilmStrip … />}
  </div>
  <aside …>{/* unchanged info pane */}</aside>
</div>
```

- **Hrefs** are built with a small helper that appends `?album=` when a nav
  context is present, so arrows, film strip, and keyboard all share one rule.
- **Arrows:** circular translucent buttons (lucide `ChevronLeft`/`ChevronRight`),
  vertically centered, `absolute` over the image. Each is a `<Link>`; **hidden at
  the ends** (no wrap-around). `prefetch` left on (default) so ←/→ is snappy.
- **Keyboard:** a `useEffect` in `PhotoDetail` maps `ArrowLeft`/`ArrowRight` to
  `router.push(prevHref / nextHref)`. Lives in the component so it works both
  standalone and in the modal. `Escape` is still handled by `RouteOverlay`
  (modal only) — unchanged, no overlap.

### `FilmStrip` (new file `film-strip.tsx`)

Isolated client component owning the strip's scroll/centering:

- Props: `items: PhotoStripItem[]`, `currentId: string`, `hrefFor(id) => string`.
- Horizontally scrollable row (`overflow-x-auto`) of ~56px square thumbnails
  (`/api/thumbnails/{id}`, `object-cover`).
- The current thumbnail is highlighted (`ring-2 ring-primary`) and
  **auto-centered** via `scrollIntoView({ inline: "center" })` in a layout effect
  keyed on `currentId` (recenters on every navigation).
- Each thumb is a `<Link prefetch={false}>` (don't prefetch ~50 routes) to
  `hrefFor(id)`.
- Rendered only when `items.length > 1`.

## Files touched

- `packages/shared/src/types.ts` — add `PhotoStripItem`, `PhotoNeighbors`.
- `apps/web/src/lib/albums-service.ts` — export `albumPhotoWhere(albumId, db)`.
- `apps/web/src/lib/photos-service.ts` — add `getPhotoNeighbors(...)`.
- `apps/web/src/app/(app)/photo/[id]/photo-detail.tsx` — vertical image column,
  arrows, keyboard nav, href helper, render `FilmStrip`.
- `apps/web/src/app/(app)/photo/[id]/film-strip.tsx` — **new**.
- `apps/web/src/app/(app)/photo/[id]/page.tsx` — read `searchParams`, load +
  pass neighbors/context (via shared `loadPhotoDetail`).
- `apps/web/src/app/(app)/@modal/(.)photo/[id]/page.tsx` — same.
- `apps/web/src/app/(app)/photos/photo-grid.tsx` — `albumId?` prop, context-aware
  tile href.
- `apps/web/src/app/(app)/albums/[id]/album-view.tsx` — pass `albumId` to grid.

## Defaults chosen (override if wanted)

- No wrap-around at the first/last photo (arrow hidden).
- Film strip shows on mobile too (scrollable below the image).
- Window = 25 photos per side (≤51 thumbnails); the strip recenters per navigation.

## Out of scope

- Swipe / touch-drag gestures on the image.
- Pinch-zoom or pan of the displayed image.
- Persisting/prefetching the whole album or library into the client.
- Slideshow / autoplay.

## Testing

Pure-logic unit tests for the neighbor query (the riskiest piece):

- `getPhotoNeighbors` against a seeded set returns correct `prevId`/`nextId` and a
  centered `strip` in `PHOTO_ORDER`.
- First photo → `prevId === null`; last photo → `nextId === null`.
- Album scope only includes that album's photos (regular **and** smart album).
- Window clamps near the ends (fewer than `window` items on the short side).

UI is verified in the browser (see below); no DOM test harness exists for these
components today.

## Verification (browser)

- Library: open a photo mid-grid → both arrows show; ←/→ and arrow clicks move
  one photo; strip recenters and highlights the current; first/last hides the
  matching arrow.
- Album: open a photo from an album → navigation and strip stay **within** the
  album (`?album=` present); count matches the album.
- Modal vs standalone render identically; Esc/back still returns to the grid at
  its prior scroll position.
- Single-photo scope: no arrows, no strip.
