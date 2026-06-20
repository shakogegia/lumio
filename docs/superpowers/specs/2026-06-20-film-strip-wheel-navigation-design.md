# Film-strip wheel/trackpad navigation

**Date:** 2026-06-20
**Branch:** `gego/albuquerque-v1`
**Status:** Approved design, ready for implementation plan

## Problem

In the lightbox, the film strip (`components/photo-grid/film-strip.tsx`) is a horizontal
thumbnail row backed by native `overflow-x-auto`. Scrolling over it with a trackpad or
mouse wheel just scrolls the thumbnails sideways — it does **not** change the photo shown
in the main image area. To move between photos you must click a thumbnail, press an arrow
key, or click an arrow button.

The user wants the film strip to behave like the filmstrip in Lightroom / iCloud Photos:
**scrolling over it navigates between photos**, updating the main image, with a
proportional "scrubby" feel (a small scroll moves one photo; a longer/faster swipe moves
several).

## Goals

- A wheel/trackpad scroll **over the film strip** steps the active photo instead of
  scrolling thumbnails natively.
- **Proportional** movement: gentle scroll = one photo; faster/longer swipe = several,
  with controlled extremes (no runaway from trackpad momentum).
- Both a vertical **mouse wheel** and a horizontal **two-finger trackpad** swipe work.
- Direction: scroll **down or right → next** photo; scroll **up or left → previous**.
- The strip keeps following along — it auto-centers on the active thumbnail (existing
  behavior), so it scrolls itself as you scrub.

## Non-goals

- The gesture is **film-strip only**. Scrolling over the main image area does nothing
  (can be added later). *(Confirmed with user.)*
- No change to thumbnail click, the draggable custom scrollbar, arrow keys, or arrow
  buttons — all unchanged.
- No new store method or change to `usePhotoCollection` / `step` semantics.
- No change to the grid, image rendering, or any `/api/*` endpoint.

## Current behavior (for reference)

- `FilmStrip({ items, currentId, onPick })` renders a scrollable row of thumbnail buttons.
  `onPick(index)` (wired in `lightbox.tsx` to `open(i)`) jumps to a photo on click.
- A `useLayoutEffect` keyed on `currentId` re-centers the active thumbnail by scrolling
  only the strip — so whenever the active photo changes (by any means) the strip follows.
- The store exposes `step(delta: 1 | -1)` (clamped at `0` / `total-1`) and `open(index)`.
  Arrow keys/buttons already call `step`; calling it repeatedly chains cleanly because
  each call is a `setOpenIndex` updater that reads the prior value and re-clamps.

## Target design

A wheel scroll over the film-strip viewport is translated into one or more `step(±1)`
calls via a delta accumulator. The split mirrors the existing
`lib/hold-key-nav.ts` pattern: a pure, DOM-free state machine plus thin DOM wiring in the
component.

### 1. Pure stepper module — `lib/wheel-step-nav.ts` (new)

DOM-free and unit-testable, like `createHoldStepper`.

```
createWheelStepper({ onStep, threshold, maxPerEvent, idleResetMs }) → { handle(e) }
```

- `handle(e)` takes a minimal event shape `{ deltaX, deltaY, deltaMode, timeStamp }`.
- **Axis:** dominant axis per event — `d = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY`.
- **deltaMode normalization:** `DOM_DELTA_LINE` (1) → `d * LINE_PX` (~16);
  `DOM_DELTA_PAGE` (2) → `d * PAGE_PX` (~400); pixel mode (0) → `d` as-is. So mice and
  trackpads are comparable.
- **Idle reset:** if `timeStamp - lastTimeStamp > idleResetMs`, drop the accumulator to 0
  before applying this event (a fresh gesture starts clean; leftover from a stopped flick
  doesn't carry over).
- **Direction-flip reset:** if `sign(d)` differs from the accumulator's sign, reset the
  accumulator to 0 (reversing direction responds immediately, no "unwind" lag).
- **Accumulate + emit:** add the normalized `d` to the accumulator; while
  `|accumulator| >= threshold` and emitted `< maxPerEvent`: call `onStep(sign)` and
  subtract `threshold * sign` (keep the remainder for the next event). The `maxPerEvent`
  cap stops a single huge momentum spike from flying through many photos at once.
- Returns nothing; navigation is the `onStep` side effect.

Constants (starting values, tunable by feel):
`THRESHOLD = 50` (px accumulated per photo), `MAX_STEPS_PER_EVENT = 3`,
`IDLE_RESET_MS = 150`, `LINE_PX = 16`, `PAGE_PX = 400`.

### 2. `FilmStrip` wiring (`components/photo-grid/film-strip.tsx`)

- New prop `onStep: (delta: 1 | -1) => void`.
- A `useEffect` attaches a **non-passive** `wheel` listener to `viewportRef`
  (`addEventListener("wheel", handler, { passive: false })`). Non-passive is required:
  React's synthetic `onWheel` is registered as a passive root listener, so
  `preventDefault()` there is ignored and warns — only a directly-attached non-passive
  listener can suppress native horizontal scroll.
- The handler calls `e.preventDefault()` and feeds the event to a `createWheelStepper`
  instance whose `onStep` reads the latest `onStep` prop **through a ref** (so the listener
  binds once and isn't re-attached on every render). The stepper instance is created once
  (per mount) and kept in a ref.
- Everything else in `FilmStrip` is unchanged; the existing auto-center effect already
  makes the strip follow the active photo as it steps.

### 3. `Lightbox` wiring (`components/photo-grid/lightbox.tsx`)

- Pass `onStep={step}` to `<FilmStrip>` (the store's existing, stable `step`).
- Multiple `onStep` calls within one wheel event call `step` repeatedly; React batches the
  updater chain and each updater re-clamps, so it lands correctly and stops at both ends.

## Error handling & edge cases

- **At either end of the set:** `step` is already a clamped no-op past `0` / `total-1`;
  excess accumulator just produces no-op steps. Reversing direction resets the accumulator,
  so backing away from an end responds immediately.
- **Few photos (strip doesn't overflow):** wheel nav still steps photos up to the ends;
  independent of overflow state.
- **Momentum after a flick:** trackpads keep firing `wheel` events for ~1s after the
  fingers lift; `maxPerEvent` caps per-event steps and the idle reset keeps the next
  deliberate gesture clean. Net effect is a controlled glide, not a runaway.
- **Mouse wheel reporting lines (`deltaMode === 1`):** normalized so one notch is a
  comparable px amount rather than a single raw unit.
- **Rapid stepping cost:** several `step` calls in one event collapse (via React batching)
  to one re-render at the final index, so the store's neighbor-preload effect runs once per
  event, not once per intermediate photo.

## Testing

**Unit** (`lib/wheel-step-nav.test.ts`, mirroring `hold-key-nav` test style)
- Sub-threshold delta emits no step; crossing the threshold emits exactly one.
- Accumulated remainder carries across events (two half-threshold events → one step).
- A delta of `N × threshold` in one event emits `min(N, maxPerEvent)` steps.
- Direction flip resets the accumulator (no lingering opposite-direction carry).
- Idle gap (`timeStamp` jump `> idleResetMs`) resets the accumulator.
- `deltaMode` line/page values are normalized (a line-mode notch crosses the threshold
  the way an equivalent pixel amount would).
- Dominant-axis selection: a larger `deltaX` drives direction even with nonzero `deltaY`.

**Browser / manual**
- Scroll over the strip with a trackpad and a mouse wheel: the main photo steps, the strip
  follows/centers, direction matches (down/right = next), small scroll = one photo, fast
  swipe = a few, momentum doesn't overshoot wildly, and it stops cleanly at both ends.
- Native sideways thumbnail scroll-by-wheel is replaced (the scrollbar drag still scrolls
  the strip without changing the photo).

## Decisions & tradeoffs

1. **Delta-accumulator** over a per-event throttle or a velocity model — gives the
   proportional feel with controlled extremes and is simple to unit-test. *(Confirmed.)*
2. **Film-strip only**, not the main image — most predictable; extensible later.
   *(Confirmed.)*
3. **Reuse `step`** rather than add a `stepBy(n)` to the store — keeps the store surface
   unchanged; the batched updater chain already clamps correctly.
4. **Non-passive native listener** rather than React `onWheel` — the only way to
   `preventDefault` native scroll reliably.
5. Constants are first-pass values to **tune by feel** during implementation/review.
