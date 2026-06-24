# Lumio Mobile — Zoomable Photo Grid

**Date:** 2026-06-23
**Status:** Designed
**Scope:** Replace the Photos tab placeholder with the active catalog's real
photos in an iOS-Photos-style, pinch-to-zoom grid with infinite scroll. Build
from reusable pieces so albums (and other photo collections) can reuse them.

## Goal

The mobile app currently shows a static `PhotoGridPlaceholder` (random picsum
images) under the Photos tab. Replace it with the **real photos from the active
catalog**, rendered like the iOS Photos app:

- Square, cover-cropped tiles in a grid.
- **Pinch-to-zoom** between a fixed set of column counts `[1, 3, 5, 8]` (default
  `3`); pinch out → fewer/larger tiles, pinch in → more/smaller tiles.
- The chosen zoom **persists** across launches (like the active catalog does).
- **Infinite scroll**: load the first page, fetch the next as the user nears the
  bottom.

The fetching and grid are built as **reusable components/hooks**, because the
same grid will back albums and other collections later.

## Non-goals (deferred)

- Opening a photo (lightbox / detail / full-screen viewer) — tapping a tile does
  nothing this milestone. The grid is the deliverable.
- Selection mode, favorites, context menus, sorting UI, month/calendar filters.
- Album screens themselves (this milestone only makes the grid *reusable* for
  them; it does not build them).
- A discrete grid-size slider control (web has one; mobile uses pinch only).
- Offline caching / a data-layer library (TanStack Query etc.) — plain fetch +
  a small hook, consistent with the existing `catalog-context`.

## Background (what already exists)

- **Data:** `GET /api/c/{slug}/photos` → `{ items: PhotoDTO[], total }`
  (`PhotosPage` in `@lumio/shared`). Offset-paginated, `limit` ≤ 100. Sort
  defaults to `imported-desc` (newest first). `PhotoDTO` carries `id`, `width`,
  `height`, `updatedAt`, and a base64 `thumbhash`.
- **Thumbnails:** `GET /api/c/{slug}/photos/{id}/thumbnail` → WebP. **Requires
  the session cookie** (route is wrapped in `withCatalog`). Web cache-busts with
  `?v=Date.parse(updatedAt)` (`rendition-url.ts`).
- **Auth on mobile:** `useAuth().getCookie()` returns a `Cookie` header string;
  `catalog-api.ts` already authenticates custom API calls with it. The grid's
  image tiles pass the same header to `expo-image`.
- **Catalog:** `useCatalogs()` (`catalog-context.tsx`) exposes `activeCatalog`
  (`{ id, name, slug }`), loading/error, and `refetch`.
- **Header:** `LargeHeaderScreen` (`large-header.tsx`) renders an iOS
  Photos-style fixed large title with a scroll-edge progressive blur. It owns its
  own `ScrollView` — which conflicts with a FlashList (see "Header" below).
- **Dependencies present:** `react-native-reanimated@4.3.1`,
  `react-native-gesture-handler@~2.31.1`, `expo-image@~56`. **Missing:**
  `@shopify/flash-list`. **Missing:** `GestureHandlerRootView` is *not* mounted
  at the root (`app/_layout.tsx`) — pinch requires it.
- **Tabs:** `NativeTabs` (native/Liquid-Glass bottom bar). FlashList content
  needs bottom padding so the last row clears the tab bar.

## Architecture — three reusable layers

The data source is decoupled from the grid so albums reuse both halves: an
album screen swaps only the *fetcher*, keeping the same pagination hook and grid.

### 1. Data fetch — `src/lib/photos-api.ts`

Mirrors the existing `catalog-api.ts` style (plain `fetch`, `Cookie` header,
user-facing error strings).

```ts
export async function fetchPhotos(
  baseURL: string,
  slug: string,
  cookie: string,
  opts: { limit: number; offset: number },
): Promise<PhotosPage>;            // GET /api/c/{slug}/photos?limit&offset

export function thumbnailUrl(
  baseURL: string,
  slug: string,
  photo: Pick<PhotoDTO, "id" | "updatedAt">,
): string;                         // /api/c/{slug}/photos/{id}/thumbnail?v=<updatedAt>
```

- `PhotosPage` / `PhotoDTO` come from `@lumio/shared` (added as a `workspace:*`
  dep), imported **type-only** — the package's barrel export means a *value*
  import would bundle the whole shared graph (incl. Node-only modules) into the
  RN app; `import type` is erased at build, so it carries the real API contract
  at zero runtime cost. No `sort` is sent — we rely on the server default
  (`imported-desc`, newest first).
- `fetchPhotos` throws "Couldn't reach the server." on network failure and
  "Couldn't load photos (NNN)." on a non-OK status, matching `catalog-api`.
- `thumbnailUrl` reuses the web cache-bust convention (`Date.parse(updatedAt)`),
  so applied edits invalidate the tile.

### 2. Pagination hook — `src/hooks/use-photo-pages.ts`

The reusable loading engine. **Source-agnostic** via a `fetchPage` callback:

```ts
export function usePhotoPages(opts: {
  fetchPage: (offset: number, limit: number) => Promise<PhotosPage>;
  deps: unknown[];          // re-fetch from scratch when these change (e.g. catalog id, sort)
  pageSize?: number;        // default 100 (API max)
}): {
  photos: PhotoDTO[];
  total: number;
  isLoading: boolean;       // first page in flight
  isLoadingMore: boolean;   // a subsequent page in flight
  error: string | null;
  loadMore: () => void;     // no-op while loading or when all loaded
  refetch: () => void;
};
```

- Photos tab passes `fetchPage = (offset, limit) => fetchPhotos(baseURL, slug,
  cookie, { offset, limit, sort })` and `deps = [baseURL, slug, sort]`. An album
  screen later passes an album-bound `fetchPage` — the hook is unchanged.
- Appends pages; stops when `photos.length >= total`. Ignores re-entrant
  `loadMore`. A `deps` change resets to offset 0.
- `setState` only inside deferred promise callbacks (never synchronously in an
  effect) — same React-Compiler-lint-safe pattern as `catalog-context`.

### 3. Presentation — `src/components/photo-grid/`

**`photo-tile.tsx`** — one square tile.

- `expo-image` `<Image>` with `contentFit="cover"`, sized to a square.
- `placeholder={{ thumbhash: photo.thumbhash }}` — expo-image decodes ThumbHash
  natively; no manual decode (web's `thumbhashDataUrl` is a browser-canvas path
  we don't need here).
- `source={{ uri: thumbnailUrl(...), headers: { Cookie: cookie } }}` so the
  authenticated endpoint serves the bytes.
- `transition` for a gentle fade-in. Memoized (`React.memo`) — tiles re-render
  only when their photo or size changes.

**`zoomable-photo-grid.tsx`** — the reusable grid. Renders `PhotoTile` directly
(generalizing to a `renderItem` prop is deferred until a non-photo grid appears).

```ts
export function ZoomablePhotoGrid(props: {
  photos: PhotoDTO[];
  baseURL: string;
  slug: string;
  cookie: string;
  zoomLevels?: number[];            // default [1, 3, 5, 8]
  initialColumns?: number;          // default 3
  onColumnsChange?: (cols: number) => void;
  onEndReached?: () => void;        // -> loadMore
  onScroll?: (e) => void;           // forwarded to the header overlay
  ListHeaderComponent?, ListFooterComponent?, ListEmptyComponent?;
  contentInset?: { top: number; bottom: number };
}): JSX.Element;
```

- Built on **`@shopify/flash-list`** with `numColumns = columns` and
  `estimatedItemSize = tileSize` where `tileSize = (screenWidth − gaps) /
  columns`. A 2px gap via tile padding (matches the web grid's small gap and the
  current placeholder's `padding: 1`).
- **Pinch:** a gesture-handler `Gesture.Pinch()` inside a `GestureDetector`
  wraps the list. A reanimated shared `scale` drives a subtle live transform on
  the list container for feedback during the pinch. On gesture end (or when the
  accumulated scale crosses a threshold), commit to the adjacent zoom level via
  the pure helper below, animate `scale` back to 1, and let FlashList re-lay-out
  at the new `numColumns`. `onColumnsChange` fires on commit.
- **`nextZoomLevel(levels, index, scale)`** — extracted **pure** function:
  `scale > THRESHOLD_IN` → next-larger tile (fewer columns, lower index);
  `scale < THRESHOLD_OUT` → next-smaller tile (more columns, higher index);
  clamps at the ends. Unit-tested; keeps the gesture component thin.
- `onEndReached` (with an `onEndReachedThreshold`) calls the parent's
  `loadMore`. `ListFooterComponent` shows a spinner while `isLoadingMore`.

## Header integration (small, justified refactor)

A FlashList can't be nested inside `LargeHeaderScreen`'s vertical `ScrollView`
(two competing vertical scrollers breaks virtualization and `onEndReached`). So
the scroll-edge header is extracted to be reusable over **any** scroller:

- Extract from `large-header.tsx`:
  - `LargeHeaderOverlay` — the absolutely-positioned title + progressive blur +
    status-bar flip, driven by a `scrolled` boolean and its animated value.
  - `useScrollEdgeHeader()` — returns `{ scrolled, onScroll }` (the threshold +
    status-bar logic currently inline in `LargeHeaderScreen`).
- `LargeHeaderScreen` is rebuilt on these two (overlay + its own `ScrollView`) so
  **simple tabs and the Albums tab are visually unchanged**.
- The Photos screen composes `LargeHeaderOverlay` over the `ZoomablePhotoGrid`,
  passing `onScroll` from `useScrollEdgeHeader()` into the FlashList. The grid's
  `contentInset` top = header height (`insets.top + TITLE_ROW + 8`), bottom =
  `insets.bottom + tab-bar clearance` (reuse the existing `+96`).

## Photos tab wiring — `src/app/(tabs)/photos/index.tsx`

1. `const { activeCatalog, isLoading: catalogLoading, error: catalogError } = useCatalogs();`
   and `const { serverUrl, getCookie } = useAuth();`.
2. Build `fetchPage` bound to `serverUrl`, `activeCatalog.slug`, `getCookie()`.
3. `usePhotoPages({ fetchPage, deps: [serverUrl, activeCatalog?.slug] })`.
4. Persist/restore the zoom column count in `SecureStore` under
   `lumio.photoGridZoom` (mirrors `catalog-context`'s `ACTIVE_KEY`); pass as
   `initialColumns`, save on `onColumnsChange`.
5. Render `LargeHeaderOverlay` + `ZoomablePhotoGrid` with the catalog photos.

**States:**
- No catalog yet / catalog loading → reuse the existing loading affordance.
- First photo page loading → centered spinner.
- Empty (`total === 0`) → "No photos yet" message (`ListEmptyComponent`).
- Error (`error` from the hook, or `catalogError`) → readable message + a Retry
  that calls `refetch`.

## Root wiring

- Wrap the app in `GestureHandlerRootView` (style `flex: 1`) in
  `app/_layout.tsx`, outside `AuthProvider` — required for the pinch gesture and
  cheap/standard for any gesture-handler use.
- `@shopify/flash-list` added via `npx expo install` (SDK-56-correct version).

## Error handling

- `fetchPhotos`: network vs. non-OK status → distinct readable messages (mirrors
  `catalog-api`). The hook surfaces the first-page error via `error`; a
  `loadMore` failure is swallowed-with-retry (doesn't blank the grid) — the
  footer simply stops spinning and `loadMore` can fire again on the next scroll.
- Missing `serverUrl`/cookie/catalog → the hook stays idle (no fetch) and the tab
  shows the appropriate empty/loading state rather than erroring.

## Testing / verification (vitest, matching the repo's pure-function approach)

Unit tests (the repo only unit-tests pure helpers — see `lib/api.test.ts`):
- `photos-api`: `fetchPhotos` builds the correct URL/query and headers and maps
  errors (mocked `fetch`); `thumbnailUrl` builds the versioned URL.
- `use-photo-pages`: pagination math — offset advances by `pageSize`, pages
  append, `loadMore` is a no-op when all loaded or already loading, `deps` change
  resets. (Test the reducer/helper logic; extract it if needed to stay
  renderer-free.)
- `nextZoomLevel`: threshold transitions and clamping at both ends.

Manual (iOS simulator, `make ios`, against a running web backend with a seeded
catalog):
- Photos tab shows real catalog thumbnails, newest first; thumbhash blur appears
  then resolves.
- Pinch in/out steps through `[1, 3, 5, 8]`; relaunch restores the last zoom.
- Scrolling to the bottom loads more (footer spinner) until `total` is reached.
- Header blur/title behaves as before over the grid; Albums tab visually
  unchanged.
- Empty catalog shows "No photos yet"; a stopped server shows the error + Retry.
