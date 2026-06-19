# Photo Grid Performance — Design

- **Date:** 2026-06-19
- **Status:** Proposed (awaiting review)
- **Scope:** Make the virtualized photo grid scroll smoothly and load fast at 5k–50k+ photos, and remove per-image DB cost from thumbnail/display serving.

## Problem

The library grid (`apps/web/src/components/photo-grid/photo-grid.tsx` + `use-photo-pages.ts`)
uses `useWindowVirtualizer` sized to **already-loaded** photos only and loads **one
page each time the bottom enters view**, with **no placeholder** for unloaded rows
(the skeleton renders only while `photos.length === 0`).

Observed live against the running server (~5k photos, 12 columns):

| state | document height | scrollable area (`totalSize`) | photos loaded |
|---|---|---|---|
| initial | 1596px | 1508px | ~120 |
| per scroll-to-bottom | +928px | +928px | **+1 page (96)** |
| end | 49,532px | 49,532px | ~5000, then `done` |

Consequences for the user:

- **Hard wall at the bottom of loaded content** — a fast trackpad fling hits the end
  of the document (height == loaded content), momentum dies → *"doesn't scroll more,
  but there are more."*
- **Blank region with no skeleton** while the next page fetch + decode completes →
  *"empty stuff"* and *"skeleton works initially but not after that."*
- **One page per fling** — traversing 5k means ~52 deliberate flings.

Server-side pagination, ordering, and `done` detection are **correct** (it reaches the
true end and stops). There is **no data-loss, premature-stop, or deadlock**. This is a
client virtualization/architecture problem, **not** a Next.js limitation. The server is
a persistent Node process (no serverless cold starts); list pages return in ~10–20ms.

A secondary cost: every `/api/thumbnails/<id>` and `/api/photos/<id>/display` request
runs `withAuth → requireSession → auth.api.getSession()`, which hits Postgres on **every
image** (no Better Auth cookie cache configured). A screen of ~100 thumbnails = ~100
session lookups. Images are already cached `immutable` for 1 year, so this is a
first-paint cost, but it is avoidable and amplifies the blank-tile symptom.

## Goals

- Stable **full-height scrollbar** from first paint — fling or drag anywhere.
- **Compositor-painted skeleton** beneath every cell — never blank, never a hard wall,
  no white flash even mid-fling.
- **Progressive previews** — instant blurred color (ThumbHash) before each thumbnail
  loads, carried in the list payload.
- **Read-ahead prefetch** so pages arrive before the user reaches them.
- **Bounded memory** regardless of library size (5k or 50k+).
- Image requests that don't each cost a DB session lookup.

## Non-goals (future, separate work)

- **Date-bucket scrubber + keyset** for 100k+ libraries / instant deep jumps.
- Streaming large originals / HTTP Range support.
- HTTP/2 verification; CDN or static file serving (only relevant if deployed serverless).

## Scale target

5k today; design for up to ~50k. With the existing `@@index([sortDate, id])`,
`@@index([createdAt, id])`, and `@@index([deletedAt, id])`, an indexed `ORDER BY` +
`OFFSET n LIMIT m` skips ~n index tuples — single-digit ms to offset ~50k. `count(*)`
runs once per grid mount. Beyond ~100k, revisit with the date-scrubber non-goal above.

## Design

### Workstream 1 — Virtualized grid

#### 1a. Data layer: offset + total

Switch the four list services from cursor (keyset) to **offset pagination** and return a
**total count**:

- `apps/web/src/lib/photos-service.ts` — `listPhotos`
- `apps/web/src/lib/albums-service.ts` — `listAlbumPhotos`
- `apps/web/src/lib/search-service.ts` — `searchPhotos`
- `apps/web/src/lib/trash-service.ts` — `listTrash`

Each becomes: `findMany({ where, skip: offset, take: limit, orderBy })` plus
`count({ where })`. Same `orderBy` (`[sortDate|createdAt|deletedAt, id]`) keeps order
deterministic.

Shared types (`packages/shared/src/api.ts`):

- `PhotosPage` → `{ items: PhotoDTO[]; total: number }` (drop `nextCursor`).
- `photosQuerySchema` (and the album/search/trash equivalents) → replace `cursor` with
  `offset: z.coerce.number().int().min(0).default(0)`; keep `limit` (1–100).

API routes (`/api/photos`, `/api/albums/[id]/photos`, `/api/search`, `/api/trash`) pass
`offset` through unchanged in shape.

**Tradeoff (accepted):** offset can dup/skip one item at a page boundary if photos are
imported/deleted mid-browse. At 5k–50k, with the grid remounting on sort/scope change and
optimistic in-place removal handled below, this is negligible. (Keyset-by-position would
avoid it at large complexity cost — rejected.)

#### 1b. Client hook: sparse paged store

Rewrite `use-photo-pages.ts` from a flat accumulating array to a **page-indexed sparse
store**:

State:
- `pages: Map<number, PhotoDTO[]>` keyed by page index (`offset / pageSize`).
- `total: number | null` (null until first fetch).
- in-flight set of page indices (dedupe concurrent fetches).
- LRU order of loaded page indices for eviction.

API returned to the grid:
- `total`
- `photoAt(index): PhotoDTO | undefined` — `pages.get(floor(index/pageSize))?.[index % pageSize]`
- `ensureRange(startIndex, endIndex)` — fetch every page intersecting the span that is
  not loaded and not in-flight; on success, store the page, update `total`, touch LRU,
  and **evict** least-recently-used pages beyond a cap (e.g. keep ~100 pages ≈ ~9.6k
  photos around the viewport). Evicted pages refetch on return.
- `patchPhotos(ids, patch)` — map matching ids across loaded pages (unchanged behavior).
- `removePhotos(ids)` — drop matching ids, decrement `total` by the count removed, and
  **evict cached pages at/after the lowest affected index** so re-scroll refetches
  correct offsets. Keeps optimistic snappiness without a full remount.
- `error` + `retry` for the visible range.

First load fetches page 0 (which also yields `total`).

**Ripple effects:**
- **Selection** (`grid-selection.ts`, `computeSelection`): operates on **loaded** photos.
  A shift-range spanning an unloaded gap selects the loaded subset in range (you can only
  act on what is visible/loaded). Build the id list from loaded pages.
- **Detail view / film-strip**: independent — it loads its own neighbors via
  `photo-detail-loader.ts`, so it is **untouched** by this change.

#### 1c. Grid component

In `photo-grid.tsx`:
- `count` for the virtualizer = `rowCount(total ?? 0, columns)` → **full height** from
  first paint once `total` is known. (Uniform square tiles, so exact height comes from a
  single `count` — no per-bucket histogram needed; see Prior art below.)
- **Skeleton placeholder = a tiled background on the timeline container**, not per-cell
  DOM. The full-height relative container gets a repeating background (an inline-SVG muted
  rounded square) with `background-size: (tileSize+gap)px (tileSize+gap)px`. Because it
  reuses the *same* `tileSize+gap` pitch as the grid, it aligns pixel-for-pixel with real
  tiles. It is compositor-painted, so during a fast fling it shows even on frames where a
  row hasn't rendered yet — **no white flash**, zero skeleton nodes, zero React churn.
- Each visible row renders only its **loaded** cells (`photoAt(start+i)` defined →
  `PhotoGridTile`); unloaded cells render nothing and the container background shows
  through. Row/cell elements stay transparent so the placeholder is visible beneath gaps.
- Replace the "last virtual row near end" effect with a **range-driven** effect: on every
  virtual-range change, call
  `ensureRange(firstRow*columns, (lastRow + PREFETCH_ROWS)*columns)` where
  `PREFETCH_ROWS ≈ 2 pages` worth of rows. This prefetches ahead and fills holes when
  dragging the scrollbar.
- Keep the full-screen skeleton only for the very first frame (before `total` is known)
  and the empty state (`total === 0`).

#### 1d. Tile decode

In `photo-thumb.tsx`, add `decoding="async"` to the `<img>` so thumbnail decode stays off
the main thread during scroll (keep `loading="lazy"`). Small change, meaningful for
fling smoothness.

### Workstream 2 — Image-serving fast path

**Runtime model (why this isn't a Next.js/"lambda" problem):** Next route handlers are
lambda-*shaped* (one exported function per route) only as a portability abstraction. On a
serverless deploy (Vercel/AWS) they become functions with cold starts — there, serving
binary images through them is genuinely slow and belongs on a CDN. **This app is
self-hosted** (`next start`/`next dev`), so it is one persistent Node process: a route
handler is an in-process async call per request, ≈ an Express handler, with no cold
starts. The real per-image cost here is the auth DB lookup below, not the framework. (If
this is ever deployed serverless, move thumbnails to static/CDN. If image concurrency gets
high, a reverse proxy / static serving in front is the lever — both are out of scope now.)

Enable **Better Auth cookie cache** in `apps/web/src/lib/auth.ts`:

```ts
session: { cookieCache: { enabled: true, maxAge: 5 * 60 } } // 5 min
```

`getSession()` then validates a signed session cookie instead of querying Postgres on
every `/api/thumbnails/<id>` and `/api/photos/<id>/display` request. Whole-app win, no
route changes, leaves the `immutable` image caching as-is.

**Tradeoff (accepted):** a revoked/logged-out session remains valid until the cookie-cache
TTL (~5 min) expires. Standard for cookie-cached sessions.

`readFile` stays buffered (not streamed) — fine for thumbnails; streaming large
originals is a separate non-goal.

### Workstream 3 — ThumbHash progressive placeholder

Immich shows a blurred color preview between the gray skeleton and the real thumbnail.
Three-layer fallback, each covering the one above: **tiled-background skeleton** (instant,
compositor-painted) → **ThumbHash blur** (paints as soon as the page's list payload
arrives) → **real WebP thumbnail** (on `<img>` load). The hash travels in the list
payload, so one page request paints a full screen of color previews; the per-image WebP
fetches only sharpen them.

- **DB** (`packages/db/prisma/schema.prisma`): add `thumbhash String?` to `Photo`; add the
  same snapshot field to `TrashedPhoto` and copy it on trash (the trash grid reuses the
  tile). Migration via Prisma.
- **Pipeline** (`packages/ingest/src/process.ts`): after the thumbnail, resize to ≤100px,
  `.ensureAlpha().raw().toBuffer()`, compute with the `thumbhash` package
  (`rgbaToThumbHash`), return base64 on `ProcessedPhoto`; persist in `store.ts`.
- **Backfill:** one-time worker task computing thumbhash for existing photos **from the
  existing thumbnail files** (no originals): read `thumbnailPath(id)` → sharp → raw →
  hash → update row. Idempotent; skip rows that already have one.
- **Shared/DTO** (`packages/shared`, `toPhotoDTO`): add `thumbhash` to `PhotoDTO`.
  ~33 chars/photo → ~3KB per 96-item page — negligible.
- **Client** (`photo-thumb.tsx`): decode `thumbhash` → data URL (`thumbHashToDataURL`),
  render as the tile placeholder beneath the `<img>`, fade out on the image's `onLoad`.
- **Dependency:** `thumbhash` (tiny, no native deps; encodes server-side, decodes client).

Independent of Workstreams 1–2 (the skeleton background is its base layer), so it ships as
**Phase 2** (fast-follow) after Phase 1.

## Sequencing

- **Phase 1 (this plan) — Workstreams 1 + 2.** The bug fix + speed: full-height
  virtualization, tiled skeleton, prefetch, eviction, `decoding="async"`, and the cookie
  cache. Pure frontend + services + one auth-config line — **no DB migration**, one PR.
- **Phase 2 (separate plan) — Workstream 3.** ThumbHash: DB column + migration, pipeline
  change, backfill of existing photos, client decode. Slots the blur layer between the
  Phase-1 skeleton and the real thumbnail without restructuring Phase 1.

## Testing

- **Services** (`*-service.test.ts`): offset + total for photos/album/search/trash —
  first page, middle page, last partial page, empty result, offset beyond end. Adapt the
  existing `photos-service.test.ts` cursor assertions to offset.
- **Hook** (pure helpers): page-index math, `ensureRange` dedupe/eviction, `removePhotos`
  index shift + page eviction, `photoAt` holes. Extract pure functions so they test
  without React.
- **Manual / browser**: full-height scrollbar present at first paint; fast fling never
  hits a hard wall; skeleton tiles show then fill; drag-to-middle loads that region;
  delete-in-place keeps subsequent scroll correct.

## File-by-file change list

- `packages/shared/src/api.ts` — `PhotosPage` shape; query schemas `cursor` → `offset`.
- `apps/web/src/lib/photos-service.ts` — offset + count.
- `apps/web/src/lib/albums-service.ts` — offset + count.
- `apps/web/src/lib/search-service.ts` — offset + count.
- `apps/web/src/lib/trash-service.ts` — offset + count.
- `apps/web/src/app/api/{photos,albums/[id]/photos,search,trash}/route.ts` — pass `offset`.
- `apps/web/src/components/photo-grid/use-photo-pages.ts` — sparse paged store rewrite.
- `apps/web/src/components/photo-grid/photo-grid.tsx` — full-count virtualizer, tiled
  background skeleton, range-driven `ensureRange`, render only loaded cells.
- `apps/web/src/components/photo-grid/photo-grid-skeleton.tsx` — the tiled background
  asset/pattern (replaces per-cell skeleton DOM); keep the first-paint full-screen variant.
- `apps/web/src/components/photo-grid/photo-thumb.tsx` — `decoding="async"`; ThumbHash
  placeholder with fade-out on load.
- `apps/web/src/lib/auth.ts` — enable `session.cookieCache`.
- `packages/db/prisma/schema.prisma` (+ migration) — `thumbhash` on `Photo`/`TrashedPhoto`.
- `packages/ingest/src/process.ts`, `store.ts` — compute + persist thumbhash.
- `packages/shared` (`toPhotoDTO`, `PhotoDTO`) — `thumbhash` field.
- `apps/worker` — one-time thumbhash backfill task (from existing thumbnails).
- `thumbhash` npm dependency.
- Tests alongside the above.

## Open decisions (resolved)

1. **Offset vs keyset:** plain offset (random access, simple; indexed; fine to ~50–100k).
2. **Cookie cache TTL:** 5 minutes.
3. **Shift-select across an unloaded gap:** selects only the loaded subset in range (does
   not fetch the gap).
4. **Sequencing:** Phase 1 = Workstreams 1+2 (no migration, one PR); Phase 2 = Workstream 3
   (ThumbHash).
