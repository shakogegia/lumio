# Mobile Photo Viewer + tap-to-zoom + aspect toggle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) tracking.

**Goal:** iOS-Photos tap behavior on the mobile grid (tap zooms one step, then opens a reusable fullscreen viewer with paging/zoom/dismiss/actions) plus a header cover↔contain aspect toggle.

**Architecture:** Extend `ZoomablePhotoGrid`/`PhotoTile` with `fit` + tap routing; add a self-contained `PhotoViewer` (RN `Modal` + reanimated custom pager + per-page zoom + shared-element open from the tapped tile rect). Reusable: the viewer takes an ordered `photos` array + `index` + `onLoadMore`, so albums reuse it with sort intact. See spec `2026-06-23-mobile-photo-viewer-design.md`.

**Tech Stack:** Expo SDK 56, reanimated 4 + gesture-handler (installed), `@shopify/flash-list`, `expo-image`, `expo-glass-effect` (installed); **new:** `expo-sharing` + `expo-file-system`. Types from `@lumio/shared` (type-only). Reanimated-heavy files carry the documented `eslint-disable react-hooks/immutability, react-hooks/refs` (see [[lumio-react-compiler-lint]]).

**Conventions:** type-only `@lumio/shared`; `Cookie` header auth; setState in effects only via deferred callbacks; vitest tests colocated under `src/**`; `Rect = { x: number; y: number; width: number; height: number }`.

---

## Phase 0 — Foundation (low-risk, headless-verifiable)

### Task 0.1: `displayUrl` + `setFavorite` (TDD)
**Files:** `src/lib/photos-api.ts`, `src/lib/photos-api.test.ts`

- [ ] Add to `photos-api.ts`:
```ts
export function displayUrl(
  baseURL: string,
  slug: string,
  photo: Pick<PhotoDTO, "id" | "updatedAt">,
): string {
  return `${baseURL}/api/c/${slug}/photos/${photo.id}/display?v=${Date.parse(photo.updatedAt)}`;
}

/** Toggle a photo's favorite flag. POST /photos/favorite { photoIds, isFavorite }. */
export async function setFavorite(
  baseURL: string,
  slug: string,
  cookie: string,
  id: string,
  isFavorite: boolean,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${baseURL}/api/c/${slug}/photos/favorite`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", Cookie: cookie },
      body: JSON.stringify({ photoIds: [id], isFavorite }),
    });
  } catch {
    throw new Error("Couldn't reach the server.");
  }
  if (!res.ok) throw new Error(`Couldn't update favorite (${res.status}).`);
}
```
- [ ] Tests: `displayUrl` builds versioned URL; `setFavorite` posts the right URL/body/headers (mock fetch) and throws on non-OK.
- [ ] Run `pnpm --filter @lumio/mobile test` → PASS. Commit.

### Task 0.2: `PhotoTile` — `fit` + measured `onPress`
**Files:** `src/components/photo-grid/photo-tile.tsx`

- [ ] Add props `fit?: "cover" | "contain"` (default "cover") → `contentFit`; `onPress?: (rect: Rect) => void`. Wrap the tile in a `Pressable`; on press, `ref.measureInWindow((x,y,width,height) => onPress({x,y,width,height}))`. Keep `memo`.
- [ ] Lint. Commit (with 0.3/0.4 — same grid surface).

### Task 0.3: `ZoomablePhotoGrid` — `fit`, `onOpenPhoto`, tap-to-zoom-step
**Files:** `src/components/photo-grid/zoomable-photo-grid.tsx`, `src/components/photo-grid/zoom.ts` (+ test)

- [ ] New props: `fit`, `openThreshold = 3`, `onOpenPhoto?: (index, rect) => void`. Thread `fit` to `PhotoTile`.
- [ ] On tile press with `(index, rect)`:
  - if `activeColumns > openThreshold`: zoom one step in — set focal to the tile rect center, run the existing `prepareZoom(focalX, focalY)`, then animate `scale` to `activeColumns / nextSmallerLevel` and `handleZoomFinish(nextSmallerLevel)` (reuse the pinch path). Extract a pure `stepInColumns(zoomLevels, current)` helper (+ test).
  - else: `onOpenPhoto(index, rect)`.
- [ ] The active layer's `PhotoTile` gets `onPress={(rect) => handleTilePress(index, rect)}`; inactive layers pass no `onPress`.
- [ ] Lint + test. Commit Tasks 0.2–0.3.

### Task 0.4: Photos tab — aspect toggle + open wiring
**Files:** `src/app/(tabs)/photos/index.tsx`, a small `src/components/photo-grid/aspect-toggle.tsx`

- [ ] `AspectToggle` — glass icon button (filled-square ↔ aspect-rectangle) calling `onToggle`.
- [ ] Photos screen: persist `fit` in SecureStore `lumio.photoGridFit` (restore on mount, like zoom); render `AspectToggle` + `SettingsMenuButton` in the header `right` slot; pass `fit` to the grid.
- [ ] Add `const [viewer, setViewer] = useState<{ index: number; rect: Rect } | null>(null)`; pass `onOpenPhoto={(index, rect) => setViewer({ index, rect })}`. (PhotoViewer render added in Phase 1.)
- [ ] Lint + test. Commit.

**Phase 0 gate:** `expo lint` clean · vitest green · `tsc -p apps/mobile` · `expo export -p ios` bundles.

---

## Phase 1 — Viewer skeleton
**Files:** `src/components/photo-viewer/photo-viewer.tsx`, `viewer-page.tsx`, `pager.ts` (+ test), `index.ts`; new deps.

- [ ] `npx expo install expo-sharing expo-file-system`. Commit dep bump.
- [ ] Pure `src/components/photo-viewer/pager.ts`: `pageWindow(index, count, radius=1) => number[]` (indices to render) and `clampIndex`. Tests.
- [ ] `ViewerPage` — full-bleed `expo-image` display rendition (`displayUrl`, Cookie header, ThumbHash placeholder), `contentFit="contain"`, sized to the screen.
- [ ] `PhotoViewer` — RN `Modal` (`transparent`, `animationType="none"`, `statusBarTranslucent`, `visible={index != null}`, `onRequestClose={onClose}`), inner `GestureHandlerRootView`, background `View` = `theme.colors.background` (opacity from a `progress`/dismiss shared value). Custom reanimated horizontal pager: `translateX` shared value, `Gesture.Pan()` (horizontal) snapping to `-screenW * page`; `runOnJS(setPage)` + `onLoadMore` when nearing the last loaded page; renders `pageWindow` pages. Top glass back button → `onClose`. Simple open: `progress` `withTiming` 0→1 (fade + slight scale).
- [ ] Vertical `Gesture.Pan()` for dismiss (active when not zoomed — Phase 3 gates on zoom; here always): translate down + fade bg via `progress`; release past threshold → `onClose`.
- [ ] Render `<PhotoViewer .../>` in the Photos screen from `viewer` state; `onClose={() => setViewer(null)}`, `photos`, `index={viewer?.index ?? null}`, `originRect`, `onLoadMore={loadMore}`.
- [ ] Lint · tsc · bundle. Commit. **Sim-test**: opens, swipes, loads more, dismisses.

---

## Phase 2 — Shared-element open/close
**Files:** `photo-viewer.tsx`

- [ ] Drive the active image with `progress` (0 = at `originRect`, 1 = fullscreen): interpolate translate/scale between the tile rect and the screen-fit rect (account for `contentFit` letterbox). Open: `progress` 0→1 `withTiming`. Close (back or swipe-down): `progress`→0 toward `originRect` when `currentIndex === openedIndex`, else scale/fade down. Background opacity = `progress`.
- [ ] Hide the underlying tile during the transition is unnecessary (Modal covers); ensure no double-image flash by showing the animating image above the pager until settled.
- [ ] Lint · tsc · bundle. Commit. **Sim-test**: zoom from/to the tile.

---

## Phase 3 — In-photo zoom
**Files:** `viewer-page.tsx`, `photo-viewer.tsx`, `zoom-math.ts` (+ test)

- [ ] Per-page shared values `scale`, `tx`, `ty`. `Gesture.Pinch()` (focal-aware) + double-tap (`Gesture.Tap().numberOfTaps(2)`) toggling 1↔~2.5 at the tap point + `Gesture.Pan()` (active when `scale > 1`) for panning, clamped to bounds. Pure `clampPan`/`zoomToPoint` helpers (+ tests).
- [ ] Gesture composition: when `scale === 1`, the page yields horizontal to the pager and vertical to dismiss; when zoomed, pinch/pan own the gesture and paging/dismiss are disabled (`Gesture.Simultaneous`/`Exclusive` + `enabled` flags). Double-tap re-enables paging/dismiss when it returns to 1.
- [ ] Lint · tsc · bundle. Commit. **Sim-test**: pinch/double-tap/pan; paging/dismiss disabled while zoomed.

---

## Phase 4 — Action bar (favorite, info, share) + chrome
**Files:** `viewer-chrome.tsx`, `viewer-info-sheet.tsx`, `viewer-actions.ts`, `photo-viewer.tsx`

- [ ] `ViewerChrome`: top = glass back + centered title (`takenAt` formatted, else filename). Bottom = Share circular `GlassView` (left) + capsule `GlassView` (right) with ♥/ⓘ/▭ (use `lib/glass.ts`; solid translucent fallback). Chrome opacity tied to a `chromeVisible` shared value; single-tap toggles; hidden during zoom/dismiss.
- [ ] **Favorite**: optimistic local `isFavorite`, call `setFavorite`, revert on error, `onFavoriteChange(photo, next)` up to the screen (update the in-memory list).
- [ ] **Info**: `ViewerInfoSheet` (RN `Modal` or a reanimated bottom sheet) listing date, `width×height`, camera make/model, filename/path, GPS from `exif` if present.
- [ ] **Share**: `viewer-actions.ts` `shareOriginal(baseURL, slug, cookie, photo)` — `FileSystem.downloadAsync(originalUrl, cacheUri, { headers: { Cookie } })` then `Sharing.shareAsync(uri)`; guard `Sharing.isAvailableAsync()`. (Add `originalUrl` to `photos-api.ts`.)
- [ ] **Adjust ▭**: rendered, `disabled`/no-op.
- [ ] Photos screen: implement `onFavoriteChange` to update the `usePhotoPages` list (expose a setter or map in place).
- [ ] Lint · tsc · bundle. Commit. **Sim-test**: favorite persists, info sheet, share sheet, chrome auto-hide.

---

## Self-review checklist
- Sort preserved (array order); paging continues in the viewer via `onLoadMore`.
- Reusable: `PhotoViewer` has no catalog coupling — only `photos/index/baseURL/slug/cookie/callbacks`.
- Theme background (black dark / white light).
- Reanimated files carry the documented eslint-disable; no `any` leaks past the FlashList/Modal boundaries.
- Animations (Phases 2–3) and gesture coordination need simulator iteration — not headless-verifiable.
