# Client-side photo lightbox over a shared photo store

**Date:** 2026-06-20
**Branch:** `gego/spa-photo-detail-navigation`
**Status:** Approved design, ready for implementation plan
**Supersedes:** `2026-06-18-photo-detail-navigation-design.md` (the intercepting-route approach this replaces)

## Problem

On a low-powered deployment (mini PC, observed live at a Tailscale address), the photo
detail experience is slow and visually broken. Three distinct root causes, all confirmed
against the running instance:

1. **Blur placeholder gets stuck on top of the loaded image.** Confirmed via live DOM
   inspection: the `/display` image is fully decoded (`complete: true`, `naturalWidth:
   1535`) while the ThumbHash blur overlay is still at `opacity: 1`, covering it. Root
   cause is the classic **cached-image `onLoad` race** — `photo-detail.tsx:149` flips
   `imgLoaded` only in the `<img onLoad>` handler, but when `/display` is served from
   cache (or fast, on a LAN) `img.complete` is already `true` before React attaches the
   handler, so `onLoad` never fires and the blur's `opacity: imgLoaded ? 0 : 1`
   (line 139) stays at 1. Reproduced **100% of the time** on the LAN.

2. **Every photo→photo navigation is a Next.js route change → RSC round-trip → `503`
   storm.** Arrow-key / arrow-button / filmstrip navigation calls `router.replace`
   (`photo-detail.tsx:109`), which fetches a fresh RSC payload from a CPU-bound server.
   The network log shows **dozens of `503 Service Unavailable`** on `_rsc` requests —
   not just the target photo but `/upload`, `/albums`, `/search`, `/photos` too (Next's
   `<Link>` prefetch of the sidebar nav + the prev/next arrows, which keep prefetch on).
   The cheap static reads (`/api/photos/[id]/display`, `/api/thumbnails/[id]`) all return
   `200`. **It is not the images that are slow; it is the per-photo server round-trip for
   server components.**

3. **The whole detail subtree remounts on every navigation.** Because navigation is a
   route change behind an intercepting/parallel route, `PhotoDetail` unmounts and
   remounts every step (`hold-key-nav.ts` exists solely to survive this). State resets,
   the `ResizeObserver` re-measures, the blur re-initializes — per keypress, on slow
   hardware.

The user's framing: make the detail view behave like an SPA (Immich-style) — grid stays
behind, the detail is an overlay, and photo↔photo movement is instant. Going client-side
eliminates #2 and #3 outright and lets us fix #1 cleanly along the way.

## Goals

- Photo↔photo navigation is **instant**: no route change, no RSC fetch, no remount, no
  `503`s. Driven by client state.
- The **grid and the detail filmstrip share one in-memory photo list** (single source of
  truth), so thumbnails the grid already loaded are reused and blur shows immediately
  from data already in memory.
- Preload neighbor `/display` images so the full image swaps with no visible wait.
- Keep **shareable, deep-linkable `/photo/[id]` URLs** and a working browser back button.
- Fix the stuck-blur bug.
- Closing the detail (Esc / back-arrow / click-out) is instant client state.

## Non-goals

- **Trash detail view is out of scope.** Trash keeps the grid for layout + selection only;
  its tiles do not open a lightbox.
- No change to image rendition generation, formats, ingest, or the `/api/*` image
  endpoints (other than one new read-only `locate` endpoint).
- No redesign of the detail UI itself (image / sidebar / EXIF / album toggles / filmstrip
  layout are reused as-is).
- No move to a global client router or full SPA shell beyond the photo views.

## Current architecture (for reference)

- **Store lives inside the grid.** `usePhotoPages(endpoint, params, pageSize)`
  (`components/photo-grid/use-photo-pages.ts`) holds a sparse, offset-paginated,
  index-addressable `PageStore` (`photo-page-store.ts`): `photoAt(index)`,
  `ensureRange(start, end)`, `total`, `patchPhotos`, `removePhotos`, LRU-capped at 60
  pages. **Only `photo-grid.tsx` calls it** (line 75).
- **Detail is a route**, rendered two ways: the full page `photo/[id]/page.tsx` and the
  intercepting overlay `@modal/(.)photo/[id]/page.tsx` (parallel `@modal` slot in
  `(app)/layout.tsx`). Both SSR `loadPhotoDetail(id, scope)`
  (`lib/photo-detail-loader.ts`), which returns the photo, album summaries, and a
  server-computed neighbor window (`getPhotoNeighbors` / `getNeighborsForWhere`, ±25).
- **Navigation** = `router.push`/`replace` per photo; `hold-key-nav.ts` is a module
  singleton owning the press-and-hold loop because the component remounts each step.
- **Four grid mount points**, each with its own scope/endpoint:
  | View | File | endpoint | params | tile href |
  |---|---|---|---|---|
  | Library | `photos/library-view.tsx` | `/api/photos` (default) | `{sort}` | `photoHref(id, –, sort)` |
  | Album | `albums/[id]/album-view.tsx` | `/api/albums/[id]/photos` | `{sort}` | `photoHref(id, albumId, sort)` |
  | Search | `search/search-view.tsx` | `/api/search` | `paramsFor(filters, sort)` | `/photo/[id]?${scopeQuery(filters, sort)}` |
  | Trash | `trash/trash-view.tsx` | `/api/photos/trash`-ish | — | (out of scope) |

## Target architecture

Invert ownership: a **provider owns one shared store**, and **both the grid and a client
lightbox read from it**. Photo↔photo navigation becomes an index change in client state.

### Components & ownership

1. **`PhotoCollectionProvider`** *(new client context, e.g.
   `components/photo-grid/photo-collection.tsx`)*
   - Owns the lifted `usePhotoPages` store (one instance per mounted view, reset via the
     same `key` the grid uses today) **and** lightbox state `openIndex: number | null`.
   - Context value: `{ total, photoAt, ensureRange, patchPhotos, removePhotos }`
     (existing store surface) `+ { openIndex, open(index), close(), step(±1) }` `+`
     scope metadata needed to build URLs (`scope`, `hrefFor`/`urlFor`).
   - Created with the same `endpoint` / `params` `usePhotoPages` takes today, plus a
     `scope` descriptor (`DetailScope` shape) used for URL building and the `locate`
     fallback. When `scope` is omitted (Trash), the lightbox is disabled and `open()` is a
     no-op.
   - Optional `initialPhoto` + `initialIndex` props seed a deep-link cold load (below).

2. **`PhotoGrid`** — virtualization unchanged. Stops calling `usePhotoPages`; reads
   `{ total, photoAt, ensureRange, patchPhotos, removePhotos }` from context. Tiles
   receive an `onOpen(index)` instead of an `href`.

3. **`PhotoGridTile`** — in normal mode, render a **real `<a href={urlFor(id)}>`** (not a
   Next `<Link>`, so it does not prefetch) whose plain left-click is intercepted with
   `preventDefault` to call `onOpen(index)`; modified clicks (middle / cmd / ctrl / shift)
   fall through to a real navigation so "open in new tab" still cold-loads the deep-link
   route (see Edge cases). Select-mode behavior unchanged.

4. **`Lightbox`** *(new client overlay, replaces the route-based detail)* — renders from
   the store: `current = photoAt(openIndex)`, `prev/next = photoAt(openIndex∓1)`,
   filmstrip window = `photoAt(openIndex-k … openIndex+k)`. Reuses the existing detail UI
   pieces (`photo-detail.tsx` body, `film-strip.tsx`, the EXIF/info/album-toggle panes)
   and the `RouteOverlay` frosted-glass + body-scroll-lock styling. Navigation is
   `step(±1)`; close is `close()`.

### The shared store (lifting `usePhotoPages`)

`usePhotoPages` moves verbatim into `PhotoCollectionProvider`; the store API is already
exactly what both consumers need (index-addressable, bidirectional `ensureRange`,
optimistic mutations). `PhotoGrid` reads it from context. No change to `photo-page-store.ts`.

`ensureRange` is already bidirectional and clamps at 0, so when the lightbox approaches
either edge of loaded data it calls `ensureRange(openIndex - W, openIndex + W)` and the
next offset page streams in — the same mechanism the grid uses, now also driven by the
lightbox.

### Navigation & URL semantics (History API, not the router)

In-session navigation never invokes Next's router (that is what triggers the RSC
round-trip). Instead it uses the **officially supported App-Router pattern** of native
`window.history.pushState` / `replaceState`, which updates the URL and integrates with
`usePathname` without re-running the server:

- `open(index)` → set `openIndex`; `window.history.pushState(null, "", urlFor(id))` so the
  detail is a new history entry (back closes it).
- `step(±1)` → change `openIndex`; `window.history.replaceState(null, "", urlFor(id))` so
  the address bar tracks the current photo without piling up history entries.
- `close()` → `window.history.back()` if the detail was opened via `pushState` in this
  session (so the grid scroll is restored), else `replaceState` back to the collection
  URL (deep-link case).
- A `popstate` listener reconciles browser back/forward with `openIndex`: parse the photo
  id from the path, map to an index (already loaded in the common case), open/close/step
  accordingly. `urlFor(id)` is `photoHref`/`scopeQuery` reused unchanged — same `?album=`
  / `?sort=` / search convention.

### Deep-link entry (`/photo/[id]` cold load / refresh / shared link)

The real route is kept and repurposed. `photo/[id]/page.tsx`:
1. Parses scope (`parseDetailScope`, unchanged).
2. SSRs the photo DTO **and its absolute index in the scope** via a new `locate` query.
3. Renders the **collection provider for that scope** (same endpoint/params the matching
   grid view would use) with `initialPhoto` + `initialIndex`, lightbox pre-opened. The
   grid mounts behind it and lazily fills.

First paint shows the SSR'd image + blur immediately (no blank). `photoAt(initialIndex)`
returns `undefined` until the containing page loads, so the provider serves `initialPhoto`
as a fallback for that index until the store page arrives. Closing lands on the grid,
scrolled to that photo. `@modal/(.)photo/[id]` is removed, so there is no longer a
soft-navigation interception — the only way to hit this route is a genuine cold load.

The **`locate` endpoint** (new, read-only): `GET /api/photos/locate?id=…&<scope params>`
→ `{ index: number }` (or `404`/`null` if the photo is not in the scope). It counts how
many photos sort before `id` in the scope, **reusing the exact `where` + `orderBy`** that
the list endpoints (`/api/photos`, `/api/albums/[id]/photos`, `/api/search`) and
`getPhotoNeighbors` already define — index alignment with the grid's offset pagination is
a hard requirement, so the ordering must come from one shared definition, not a
re-derivation. Implemented as a Prisma `count` with a keyset predicate
(`(sortKey, id)` strictly before the cursor). O(index) but on indexed columns; acceptable
for personal-scale libraries (documented caveat: revisit with a precomputed ordinal if
libraries ever reach the millions).

### Blur fix (folded in)

The lightbox keeps **one persistent `<img>`** whose `src` changes per navigation (no
remount). A small `useImageLoaded(src)` hook (`lib/use-image-loaded.ts`) owns the loaded
flag:
- resets to `false` when `src` changes,
- sets `true` from **both** the `<img onLoad>` **and** an immediate
  `node.complete && node.naturalWidth > 0` check in a ref callback (closing the cached
  race),
- the blur fades (`opacity → 0`) only when loaded.

Because blur data (`photo.thumbhash`) is already in the store, blur renders on the first
frame; the pixel-perfect `blurBox` measurement is kept but no longer gates the blur's
existence (show with the contain-aspect box, refine on measure).

### Keyboard navigation (simplified)

`hold-key-nav.ts`'s module singleton existed only to survive remounts. With no remount,
the press-and-hold loop moves into the `Lightbox` component as a normal effect. The pure,
unit-tested state machine `createHoldStepper` is **kept**; only the DOM-singleton adapter
(`setHoldNavTarget`, `ensureWired`) is removed and replaced by in-component keydown/keyup
wiring that calls `step(±1)`. `Escape` calls `close()`. Same guards (ignore repeat, ignore
when typing in a field, ignore modified arrows, stop on blur/visibilitychange).

### Mutations via the store (bonus the unification unlocks)

The detail's album-toggle currently does `router.refresh()`. From the lightbox, album
toggle / color label / move-to-trash call the store's existing `patchPhotos` /
`removePhotos` so the grid updates in place with no server re-render. Move-to-trash from
the lightbox advances to the next photo (or closes if it was the last). This also lets the
album and search views drop some `router.refresh()` churn, but only where it directly
serves this work — no unrelated refactoring.

### Per-view wiring

| View | Change |
|---|---|
| Library | Wrap `<PhotoGrid>` in `<PhotoCollectionProvider scope={{kind:"library",sort}} endpoint="/api/photos" params={{sort}}>`. Render `<Lightbox>` inside. |
| Album | Same, `scope={{kind:"album",albumId,sort}}`, `endpoint=/api/albums/[id]/photos`. |
| Search | Same, `scope={{kind:"search",filters,sort}}`, `endpoint=/api/search`, URL via `scopeQuery`. |
| Trash | Wrap in provider **without** `scope` (store only, lightbox disabled); tiles inert in normal mode. |

## What gets removed

- `app/(app)/@modal/(.)photo/[id]/page.tsx` and the `@modal` parallel slot wiring in
  `app/(app)/layout.tsx`.
- The DOM-singleton half of `lib/hold-key-nav.ts` (keep `createHoldStepper` + its tests).
- The `<Link>`-based navigation in `photo-grid-tile.tsx` and `film-strip.tsx`; the
  prev/next `NavArrow` `<Link>`s in `photo-detail.tsx`.
- Add `prefetch={false}` to the sidebar nav links (`components/app-sidebar.tsx`) to kill
  the residual `/photos|/albums|/search|/upload` RSC `503`s.
- `route-overlay.tsx`'s pathname-driven visibility (its scroll-lock + frosted-glass
  styling is reused by the lightbox, but visibility becomes `openIndex != null`).

## Error handling & edge cases

- **`locate` miss** (photo deleted / not in scope / stale link): `photo/[id]/page.tsx`
  `notFound()`s, as today for a missing photo.
- **Store page for `initialIndex` not yet loaded:** provider serves `initialPhoto`
  fallback so the lightbox never renders an empty frame.
- **Edge of the set:** `step` past index 0 or `total-1` is a no-op (no prev/next arrow,
  matching today).
- **Middle-click / cmd-click / right-click "open in new tab"** on a grid tile must still
  work — render a real anchor with the canonical `urlFor(id)` and only `preventDefault` on
  a plain left click; modified clicks fall through to a real new-tab navigation (which
  cold-loads the deep-link route).
- **Mutation mid-flight** (delete while a page fetch is in flight): the store's existing
  `mutationGen` guard already drops stale page results; reused unchanged.
- **Sort / search-query change** rebuilds the provider via `key` (as the grid does today),
  which closes any open lightbox — correct, since indices are invalidated.
- **`popstate` to a photo not in the loaded store** (deep history jump): fall back to a
  `locate` fetch to resolve the index, or, if that misses, let the route cold-load.

## Testing

**Unit**
- `locate` index math against fixtures for each scope (library / album / search), incl.
  the keyset tie-break on equal sort keys.
- `useImageLoaded`: cached image (`complete` true at mount) resolves loaded without an
  `onLoad` event; src change resets then re-resolves.
- Store bidirectional `ensureRange` from a mid-set index (already covered; extend if
  needed).
- Keep existing `createHoldStepper` tests; adapt the wiring tests for in-component use.

**Browser / integration** (the regressions that motivated this)
- Grid → open → arrow-nav several photos and assert **no `…/_rsc…` photo request fires**
  (network), proving navigation is fully client-side.
- Blur opacity reaches `0` on a cached `/display` image (the stuck-blur regression).
- Neighbor `/display` images are preloaded (present in network before navigating).
- Deep-link cold load renders the image immediately and, on close, shows the grid scrolled
  to that photo.
- Esc / browser back / `popstate` open/close/step correctly; URL tracks the current photo.
- Trash tiles do not open a lightbox.

## Decisions & tradeoffs

1. **In-session navigation bypasses Next's router** in favor of native
   `window.history.pushState`/`replaceState`. This is the crux: it is the only way to get
   instant navigation while keeping real, shareable URLs, and it is a documented
   App-Router pattern (not a hack). Deep-link / refresh / share still go through the real
   SSR route. *(Confirmed with user.)*
2. **Deep-link entry renders grid + pre-opened lightbox, seeded by a new `locate` index
   query** (full unification; close lands on the grid), rather than the lighter "SSR just
   the photo, load the grid only on close." *(Confirmed with user.)* Cost: one new
   read-only `count`-based endpoint.
3. **Trash is detail-less.** *(Confirmed with user.)*
4. **Keep the offset-indexed store** (vs. a separate keyset window for the lightbox) so the
   grid and filmstrip genuinely share one list — the user's explicit goal. The price is the
   `locate` query on cold entry.

## Risks / open questions

- `locate` cost on very large libraries (mitigated for personal scale; caveat documented).
- Scroll-restore on close depends on the grid view staying mounted behind the lightbox —
  verify the body-pin scroll lock from `route-overlay.tsx` ports cleanly to the
  state-driven overlay.
- `popstate` reconciliation for deep history jumps is the fiddliest piece; the plan should
  call it out as its own step with explicit test coverage.
