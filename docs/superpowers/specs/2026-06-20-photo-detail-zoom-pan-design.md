# Photo detail zoom & pan (iCloud-style)

**Date:** 2026-06-20
**Status:** Approved, pending implementation plan

## Problem

The photo detail view (the `Lightbox` → `LightboxImage`) shows a static
`object-contain` image. There's no way to zoom in to inspect detail. We want the
iCloud Photos web experience: a top-left zoom control (slider + `–`/`+`), pinch
and wheel zoom toward the cursor, and click-drag / 2-finger-swipe panning once
zoomed.

## Goals

- A **top-left zoom control** over the image pane, always visible:
  - shadcn `Slider`, horizontal, **1% step**, left end = fit, right end = 400%.
  - `–` and `+` icon buttons flanking the slider that jump between **stops**:
    fit → 100 → 200 → 300 → 400 (dropping any stop at/below the current fit).
- **Zoom range:** min = fit scale, max = 400% of original 1:1 pixels.
- **True-pixel semantics:** `100%` = one original-image pixel per screen pixel
  (the iCloud model). `fit` is a separate minimum, usually below 100% for large
  photos.
- **Pinch (trackpad)** and **Ctrl/⌘+wheel** zoom toward the cursor.
- **Plain wheel / 2-finger swipe** pans when zoomed in; no-op at fit.
- **Click-drag** pans when zoomed (grab/grabbing cursor).
- **Double-click** toggles fit ↔ 100%, centered on the cursor.
- **Pan clamping** keeps the image from being dragged into empty space.
- **Reset to fit** on navigate (arrows / film strip / keyboard) and on close.
- **Original-swap:** on first zoom past fit, lazily fetch `/original` and swap it
  in for crispness; show the scaled 2048 rendition until it arrives.

## Non-goals

- **Touchscreen** (phone/tablet) native touch pinch and swipe-vs-pan
  disambiguation. Desktop/laptop (mouse + trackpad) only for now; touch is a
  fast-follow.
- Tiled/deep-zoom (OpenSeadragon-style) loading. A single original-image swap is
  enough; we don't tile.
- Rotation, flip, or any editing.
- Persisting zoom state across photos or sessions.
- A third-party zoom/pan library — built in-house (see Approach).

## Approach

Custom **headless `useZoomPan` hook** driving a single CSS `transform`, backed by
a **pure `zoom-math` module**. No new dependencies.

Rejected: `react-zoom-pan-pinch` / `panzoom` — matching the precise fit/100/…/400
stops, true-pixel 100%, the original-swap, and the existing arrow/keyboard/film-
strip integration would cost more than it saves and add a dependency. Native CSS
zoom — desktop trackpad pinch isn't a native `<div>` gesture and a controlled
slider needs JS state regardless.

## Geometry (the key insight)

The **original** dimensions are already known from `photo.width/height` in the
DTO, so all zoom math is independent of which rendition is loaded — the rendition
only affects sharpness, never layout.

Definitions (all in CSS px against the viewport, the image pane's content box):

- `zoom` is a percentage; `zoom = 100` ⇒ original 1:1 pixels.
- `fitScale = min(1, min(viewportW / photo.width, viewportH / photo.height))`
  — never upscales past 100% to "fill". `fitZoom = fitScale * 100`.
- The base `<img>` is laid out at **fit** size (`object-contain`). The applied
  transform scale is `s = zoom / fitZoom`, so `s = 1` at fit.
- Slider domain is `[fitZoom, 400]`, step `1`.
- `stops = [fitZoom, 100, 200, 300, 400]` with entries `<= fitZoom` dropped
  (the first stop is always `fitZoom`). `+`/`–` move to the next/previous stop.

## Rendering model

The image pane (`LightboxImage`'s container) becomes a **viewport**:
`position: relative; overflow: hidden; touch-action: none`. Inside it:

- A **transform layer** (`will-change: transform`) holding the blur placeholder
  and the main `<img>`, both at fit size. The layer carries
  `transform: translate(x, y) scale(s)`. `transform-origin: center` (math below
  assumes center origin; offsets are measured from the centered fit position).
- The **zoom control** and **nav arrows** live *outside* the transform layer
  (absolutely positioned in the viewport) so they don't move or scale.

Because zoom only becomes available after the image has loaded (the blur is gone
at that point and the transform is identity at fit), the existing blur-up
behavior (`useBlurBox`) is unaffected — it plays at fit/identity per photo.

### Zoom toward a point

On wheel/pinch/double-click we zoom toward the cursor: given the pointer position
relative to the viewport center, adjust `offset` so the image point under the
cursor stays under the cursor after the scale change. Pure function in
`zoom-math`.

### Pan clamping

`clampOffset(offset, scaledSize, viewportSize)`: for each axis, if the scaled
image is larger than the viewport, clamp the offset to `±(scaled - viewport)/2`
(can't reveal empty space past an edge); if smaller (e.g. a tall image at low
zoom on a wide viewport), lock that axis to `0` (stays centered). Applied after
every pan and after every zoom change.

## Original-swap

On the first transition to `zoom > fitZoom` for a given photo:

1. Preload via `new Image()` with `src = /api/photos/{id}/original`.
2. `await image.decode()`.
3. Swap the visible `<img>`'s `src` to the original (browser cache hit ⇒ no
   flash). Layout is unchanged (same fit size, just a sharper source).

Guarded so it fires once per photo. Failure (e.g. original missing → 404) is
swallowed; we keep showing the rendition (still usable, just softer at high
zoom). The remount-per-photo (below) naturally resets this guard.

## Reset on navigate

Key the zoomable image on `photo.id` (`<ZoomableImage key={photo.id} … />`) so a
new photo mounts fresh: `zoom` returns to fit, offset to 0, and the original-swap
guard resets. The blur-up still plays per photo. Escape-to-close and the existing
hold-to-repeat arrow-key navigation in `Lightbox` are untouched; navigating
remounts and thus resets zoom.

## Inputs (desktop/laptop)

- **Pointer events** on the transform layer for drag-pan (`onPointerDown` +
  capture, `onPointerMove`, `onPointerUp`); only pans when `zoom > fitZoom`.
  Cursor: `grab` when zoomable, `grabbing` while dragging, default at fit.
- **`wheel`** handler on the viewport (non-passive, `preventDefault`):
  - `e.ctrlKey` (trackpad pinch / ⌘-wheel) ⇒ zoom toward cursor by a factor of
    the wheel delta.
  - plain wheel ⇒ pan by `(deltaX, deltaY)` when zoomed; no-op at fit.
- **`dblclick`** ⇒ toggle fit ↔ 100% centered on the cursor.
- `touch-action: none` on the viewport prevents the browser from hijacking
  trackpad/gesture scrolling.

A plain click at fit must still reach the existing backdrop-close behavior on the
overlay (don't swallow non-drag clicks).

## Module boundaries

Each unit has one purpose, a clear interface, and is independently testable.

### `apps/web/src/lib/zoom-math.ts` (pure, unit-tested)

- `computeFitZoom(photo, viewport) → number`
- `computeStops(fitZoom) → number[]` (fit, then 100/200/300/400 above fit)
- `nextStop(zoom, stops) / prevStop(zoom, stops) → number`
- `clampOffset(offset, scaledSize, viewportSize) → {x, y}`
- `zoomToward(point, fromZoom, toZoom, offset, viewport, photo) → {x, y}`
- `clampZoom(zoom, fitZoom) → number` (into `[fitZoom, 400]`)

### `apps/web/src/components/photo-grid/use-zoom-pan.ts` (headless hook)

- Input: `photo`, a ref/size of the viewport (via `ResizeObserver`).
- State: `{ zoom, offset }`, derived `fitZoom`, `stops`, `transform` string,
  `isZoomed`.
- Returns event handlers (`onWheel`, `onPointerDown/Move/Up`, `onDoubleClick`)
  and imperative API (`setZoom`, `stepIn`, `stepOut`, `reset`).
- Follows project React-Compiler lint rules (refs in effects, no setState via
  direct effect body, `"use client"` first line where needed).

### `apps/web/src/components/photo-grid/zoom-controls.tsx` (presentational)

- Top-left overlay: `–` `Button`, `Slider` (min `fitZoom`, max `400`, step `1`,
  value `[zoom]`, `onValueChange`), `+` `Button`. Outline icon-button style to
  match the existing toolbar/nav idiom (`backdrop-blur`). Buttons call
  `stepOut`/`stepIn`; slider calls `setZoom`.

### `apps/web/src/components/photo-grid/zoomable-image.tsx` (extracted)

- Extracted from today's `LightboxImage`: hosts the viewport + transform layer,
  wires `useZoomPan` to the `<img>`, renders `ZoomControls`, keeps the blur
  placeholder and `useBlurBox`/`useImageLoaded` wiring, manages the
  original-swap, and renders the prev/next `NavArrow`s (which still call `step`).
- `Lightbox` renders `<ZoomableImage key={photo.id} photo={photo} … />` in place
  of the inline `LightboxImage`.

## Testing

- **Unit (`zoom-math.test.ts`, vitest, matching existing `*.test.ts`):**
  - `computeFitZoom`: large photo (fit < 100), small photo (fit capped at 100).
  - `computeStops` / `nextStop` / `prevStop`: stop list with fit below 100 (e.g.
    `[30,100,200,300,400]`) and fit above some stops; stepping at the ends.
  - `clampOffset`: image larger than viewport (clamps to edges), smaller axis
    locks to 0.
  - `zoomToward`: cursor-anchored point stays fixed across a scale change.
  - `clampZoom`: bounds at `fitZoom` and `400`.
- **Browser verification (per project workflow):** in the detail view —
  slider drags 1% and zooms; `+`/`–` walk fit→100→200→300→400 and back; trackpad
  pinch and ⌘-wheel zoom toward the cursor; plain wheel / 2-finger swipe pan when
  zoomed; click-drag pans with grab cursor; double-click toggles fit↔100% at the
  cursor; pan clamps at edges; navigating (arrows/strip/keys) resets to fit; the
  original swaps in crisply at high zoom; closing resets.

## Risks

- **Original size:** very large originals are slow to decode/swap; mitigated by
  fetching only on first zoom and keeping the rendition visible meanwhile.
- **Wheel/pinch tuning:** the delta→zoom factor needs browser tuning to feel like
  iCloud (smooth, not jumpy); pure-function math makes this a single constant.
- **Backdrop-close vs. drag:** must distinguish a pan drag from a plain click so
  closing-on-backdrop and fit-state clicks still work.
- **`touch-action: none`** disables native scroll within the pane — acceptable
  since the pane is a fixed-size viewport, not a scroll region.
