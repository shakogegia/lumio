# Lumio Mobile — Fullscreen Photo Viewer, tap-to-zoom & aspect toggle

**Date:** 2026-06-23
**Status:** Designed (approved)
**Scope:** Make the mobile photo grid tappable like iOS Photos: tap zooms one
step until it opens a reusable fullscreen viewer (swipe between photos, zoom,
swipe-to-dismiss, actions). Add a header toggle for cover vs. contain thumbnails.
Reusable so albums get the same viewer over their own (sorted) photos.

## Goal

Build on the existing `ZoomablePhotoGrid` ([[2026-06-23-mobile-zoomable-photo-grid-design]]):

1. **Tap routing.** Tapping a tile:
   - at a dense zoom (columns > 3, i.e. 5 or 8) → **zoom in one step**,
     focal-anchored on the tapped tile (reuses the grid's multi-layer machinery);
   - at columns ≤ 3 (3 or 1) → **open the fullscreen viewer** at that photo, with
     an iOS shared-element zoom from the tile.
2. **Reusable `PhotoViewer`** — fullscreen, paged, collection-agnostic:
   - swipe left/right between photos (sort preserved; pagination continues),
   - pinch / double-tap / pan to zoom within a photo,
   - swipe-down-to-dismiss (drives the close animation),
   - chrome: glass back + date/time title (top); action bar (bottom),
   - **background follows the theme** — black in dark mode, white in light.
3. **Aspect toggle** — a header icon flips grid thumbnails between **cover**
   (square crop, current) and **contain** (whole photo, letterboxed), persisted.

## Non-goals (deferred)

- In-app photo **editor** — the bottom "adjust" button is a visible placeholder
  (no mobile editor exists yet).
- Geocoded **place names** in the title — Lumio stores no reverse-geocoded
  location, so the title shows date/time only (the iOS "Maastricht – Hees" line
  has no data behind it).
- Selection mode, context menus, trash/delete from the viewer, the film-strip
  scrubber, slideshow.
- Close-animating back to a tile that scrolled offscreen after paging (v1 closes
  to the original tile when the index is unchanged, else a scale/fade down).

## Background (what exists)

- `ZoomablePhotoGrid` / `PhotoTile` (FlashList multi-layer pinch grid) and
  `usePhotoPages` (ordered `photos` + `loadMore`) — the viewer reuses the same
  ordered array, so **sort is preserved by array order** and paging continues.
- `photos-api.ts`: `fetchPhotos`, `thumbnailUrl`. Add `displayUrl` + `setFavorite`.
- Full image: `GET /api/c/{slug}/photos/{id}/display` (WebP, edited-or-base,
  cookie-authed, `?v=updatedAt`). Favorite: `POST /api/c/{slug}/photos/favorite`
  `{ photoIds: string[], isFavorite: boolean }`.
- `PhotoDTO` has `path`, `width`, `height`, `takenAt`, `isFavorite`, `exif`
  (camera make/model, GPS in the dump) — enough for the title + info sheet.
- Glass: `expo-glass-effect` via `lib/glass.ts` (`GLASS` flag). Reanimated 4 +
  gesture-handler installed. `expo-image` decodes ThumbHash + sends Cookie.

## Architecture

### Data client additions (`src/lib/photos-api.ts`)
- `displayUrl(baseURL, slug, photo)` → `/photos/{id}/display?v=<updatedAt>`.
- `setFavorite(baseURL, slug, cookie, id, isFavorite)` → POST favorite.

### Grid changes (`components/photo-grid/`)
- **`PhotoTile`**: new `fit: "cover" | "contain"` (default cover) → `contentFit`.
  New `onPress?: (rect: Rect) => void`; on press it `measureInWindow`s its cell
  and reports the screen rect (for the shared-element open) — the grid maps it to
  the photo's index.
- **`ZoomablePhotoGrid`**: new props `fit`, `openThreshold = 3`,
  `onOpenPhoto?: (index: number, rect: Rect) => void`. On tile press:
  columns > openThreshold → zoom one step (focal-anchored on the tile, reusing
  `prepareZoom`/`handleZoomFinish`); else → `onOpenPhoto(index, rect)`.

### Reusable viewer (`components/photo-viewer/`)
A self-contained component rendered by each screen, controlled by state:
```
<PhotoViewer
  photos={PhotoDTO[]}      // ordered collection (sort preserved)
  index={number | null}    // open at index; null = closed
  originRect={Rect | null} // tapped tile rect → open/close animation
  baseURL slug cookie
  onClose() onLoadMore?() onFavoriteChange?(photo, next)
/>
```
- Rendered as a React Native **`Modal`** (`transparent`, `animationType="none"`,
  `statusBarTranslucent`) so it covers the native tab bar; content wrapped in its
  own `GestureHandlerRootView` (gestures don't cross the Modal boundary).
- **Background** = `useTheme().colors.background` (black dark / white light),
  its opacity driven by the open/dismiss progress.
- **Pager**: a custom reanimated horizontal pager — a `translateX` shared value,
  windowed to render current ± 1 page. Owning paging in reanimated (vs a native
  scroll list) lets it coordinate with the per-photo zoom and the vertical
  dismiss via gesture composition. Paging past the last loaded page calls
  `onLoadMore`.
- **Page** (`ViewerPage`): the display-rendition image (`expo-image`, Cookie
  header, ThumbHash placeholder) with pinch + double-tap + pan zoom (reanimated
  shared values per page; pan only when zoomed). When zoom == 1 the page yields
  the vertical gesture to dismiss and the horizontal to the pager.
- **Open/close (shared element)**: from `originRect`, an `progress` shared value
  interpolates the active image from the tile rect → fullscreen on open, and back
  on close. Swipe-down drives `progress`/translate + background fade; release past
  threshold completes close (`onClose`).
- **Chrome** (`ViewerChrome`): top — glass back chevron (left) + centered title
  (`takenAt` → "December 4, 2019" / "2:07 PM", else filename); bottom — **Share**
  circular glass button (left) and a glass capsule (right) with **♥ favorite · ⓘ
  info · ▭ adjust**. Chrome auto-hides on single-tap and during zoom/dismiss
  (opacity tied to a shared value).

### Actions
- **Favorite ♥** — optimistic toggle via `setFavorite`; bubbles up
  `onFavoriteChange` so the grid/collection stays in sync. Heart fills when set.
- **Info ⓘ** — a bottom sheet (`ViewerInfoSheet`) listing date, dimensions,
  camera make/model, filename/path, and GPS coords if present in `exif`.
- **Share** — `expo-file-system` downloads the original (Cookie header) to cache,
  then `expo-sharing` `shareAsync` opens the OS share sheet.
- **Adjust ▭** — rendered, **disabled/no-op placeholder** (no mobile editor yet).

### Aspect toggle (`(tabs)/photos/index.tsx` + header)
A glass header button (added to the header `right` slot beside settings) toggles
`fit` between "cover" and "contain", persisted in SecureStore
(`lumio.photoGridFit`), passed to `ZoomablePhotoGrid`. Icon reflects state
(filled square ↔ aspect rectangle).

### Reuse
`PhotoViewer` takes a `photos` array + `index` + `onLoadMore`, so the Photos tab
passes its `usePhotoPages` results and a future album screen passes the album's —
same component, same paging, sort intact. The grid emits `onOpenPhoto`; each
screen wires it to its own `PhotoViewer` state.

### New dependencies
`expo-sharing` + `expo-file-system` (Share), via `expo install`. Paging/zoom use
the installed reanimated + gesture-handler; glass uses installed
`expo-glass-effect`.

## Phasing (each phase shippable & sim-testable)

- **Phase 0 — foundation (low-risk, headless-verifiable):** `displayUrl` +
  `setFavorite` (+ tests); `PhotoTile` `fit` + `onPress`/measure; grid `fit`,
  `onOpenPhoto`, tap-to-zoom-step; Photos-tab aspect toggle (persisted) + wire
  `onOpenPhoto` to viewer state.
- **Phase 1 — viewer skeleton:** `PhotoViewer` Modal (theme bg, custom horizontal
  pager, back button, simple fade/scale open, swipe-down dismiss), display image.
- **Phase 2 — shared-element open/close** from the tile rect.
- **Phase 3 — in-photo zoom** (pinch / double-tap / pan, gesture coordination).
- **Phase 4 — action bar:** favorite (wired), info sheet, share; glass styling;
  adjust placeholder; chrome auto-hide.

## Error handling
- Display fetch failure → ThumbHash placeholder stays + a subtle retry; never
  crashes the pager.
- Favorite failure → revert the optimistic toggle, leave a brief message.
- Share failure (download/sheet) → ignore silently (no crash); not blocking.

## Testing / verification
- Unit (vitest): `displayUrl`/`setFavorite` URL+body+headers; any pure helpers
  (pager window math, dismiss-threshold, zoom clamp, focal-from-rect for
  tap-zoom) extracted and tested.
- Headless per phase: `expo lint`, `tsc -p apps/mobile`, `expo export -p ios`.
- Manual (simulator, `make ios`): tap-zoom steps; open at 3/1 with the
  shared-element zoom; swipe between (loads more); pinch/double-tap/pan;
  swipe-down dismiss; favorite/info/share; aspect toggle persists; viewer bg
  matches theme. **Animations require simulator iteration — flagged in the plan.**
