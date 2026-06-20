# Film-strip wheel/trackpad navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a wheel/trackpad scroll over the lightbox film strip navigate between photos (proportional, Lightroom/iCloud-style) instead of scrolling thumbnails.

**Architecture:** A pure, DOM-free delta-accumulator (`lib/wheel-step-nav.ts`, mirroring the existing `lib/hold-key-nav.ts` split) converts wheel events into `step(±1)` calls. `FilmStrip` attaches a non-passive `wheel` listener that `preventDefault`s native thumbnail scrolling and feeds the stepper; the `Lightbox` wires the stepper's output to the store's existing `step`. No store changes.

**Tech Stack:** TypeScript, React 19 + React Compiler eslint rules, Next.js (web app), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-20-film-strip-wheel-navigation-design.md`

---

## File Structure

- **Create** `apps/web/src/lib/wheel-step-nav.ts` — pure stepper: accumulates normalized wheel delta, emits `onStep(±1)` per threshold crossing, with idle/direction-flip resets and a per-event cap. One responsibility: delta → discrete steps.
- **Create** `apps/web/src/lib/wheel-step-nav.test.ts` — unit tests for the stepper.
- **Modify** `apps/web/src/components/photo-grid/film-strip.tsx` — add `onStep` prop + a non-passive `wheel` listener effect that feeds the stepper.
- **Modify** `apps/web/src/components/photo-grid/lightbox.tsx` — pass `onStep={step}` to `<FilmStrip>`.

---

## Task 1: Pure wheel-step stepper (`wheel-step-nav.ts`)

**Files:**
- Create: `apps/web/src/lib/wheel-step-nav.ts`
- Test: `apps/web/src/lib/wheel-step-nav.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/wheel-step-nav.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createWheelStepper, type WheelStepEvent } from "./wheel-step-nav";

// Build a wheel-event-like object. Defaults: pixel mode, timeStamp 0.
function ev(partial: Partial<WheelStepEvent>): WheelStepEvent {
  return { deltaX: 0, deltaY: 0, deltaMode: 0, timeStamp: 0, ...partial };
}

// threshold 50, maxPerEvent 3, idleResetMs 150 are the library defaults; we pass
// them explicitly in tests so the expectations don't depend on the constants.
function setup() {
  const onStep = vi.fn();
  const stepper = createWheelStepper({
    onStep,
    threshold: 50,
    maxPerEvent: 3,
    idleResetMs: 150,
  });
  return { stepper, onStep };
}

describe("createWheelStepper", () => {
  it("does not step below the threshold", () => {
    const { stepper, onStep } = setup();
    stepper.handle(ev({ deltaY: 25, timeStamp: 0 }));
    expect(onStep).not.toHaveBeenCalled();
  });

  it("steps once when the threshold is crossed (down/right = next = +1)", () => {
    const { stepper, onStep } = setup();
    stepper.handle(ev({ deltaY: 50, timeStamp: 0 }));
    expect(onStep).toHaveBeenCalledTimes(1);
    expect(onStep).toHaveBeenLastCalledWith(1);
  });

  it("steps -1 for upward/leftward scroll", () => {
    const { stepper, onStep } = setup();
    stepper.handle(ev({ deltaY: -50, timeStamp: 0 }));
    expect(onStep).toHaveBeenCalledTimes(1);
    expect(onStep).toHaveBeenLastCalledWith(-1);
  });

  it("carries the remainder across events (two half-threshold events = one step)", () => {
    const { stepper, onStep } = setup();
    stepper.handle(ev({ deltaY: 25, timeStamp: 0 }));
    stepper.handle(ev({ deltaY: 25, timeStamp: 10 }));
    expect(onStep).toHaveBeenCalledTimes(1);
  });

  it("caps steps per event at maxPerEvent", () => {
    const { stepper, onStep } = setup();
    // 5 * threshold in one event, capped to 3.
    stepper.handle(ev({ deltaY: 250, timeStamp: 0 }));
    expect(onStep).toHaveBeenCalledTimes(3);
  });

  it("does not bank capped excess for later events (no momentum overshoot)", () => {
    const { stepper, onStep } = setup();
    stepper.handle(ev({ deltaY: 250, timeStamp: 0 })); // caps at 3, discards excess
    onStep.mockClear();
    // A tiny follow-up event must not dump banked steps.
    stepper.handle(ev({ deltaY: 5, timeStamp: 10 }));
    expect(onStep).not.toHaveBeenCalled();
  });

  it("resets the accumulator when direction flips", () => {
    const { stepper, onStep } = setup();
    stepper.handle(ev({ deltaY: 40, timeStamp: 0 })); // +40, no step
    stepper.handle(ev({ deltaY: -40, timeStamp: 10 })); // flip resets, then -40, no step
    expect(onStep).not.toHaveBeenCalled();
  });

  it("resets the accumulator after an idle gap", () => {
    const { stepper, onStep } = setup();
    stepper.handle(ev({ deltaY: 40, timeStamp: 0 })); // +40, no step
    stepper.handle(ev({ deltaY: 40, timeStamp: 200 })); // gap > 150ms resets, +40, no step
    expect(onStep).not.toHaveBeenCalled();
  });

  it("uses the dominant axis (horizontal trackpad swipe navigates)", () => {
    const { stepper, onStep } = setup();
    // deltaX dominates deltaY -> +1 from the horizontal component.
    stepper.handle(ev({ deltaX: 60, deltaY: 10, timeStamp: 0 }));
    expect(onStep).toHaveBeenLastCalledWith(1);
  });

  it("normalizes line-mode delta so a notch crosses the threshold", () => {
    const { stepper, onStep } = setup();
    // deltaMode 1 (lines): 4 lines * 16px = 64px >= 50 -> one step.
    stepper.handle(ev({ deltaY: 4, deltaMode: 1, timeStamp: 0 }));
    expect(onStep).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @lumio/web test src/lib/wheel-step-nav.test.ts`
Expected: FAIL — cannot resolve `./wheel-step-nav` (module not created yet).

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/lib/wheel-step-nav.ts`:

```ts
// Wheel/trackpad → discrete photo-step navigation for the film strip. Pure and
// DOM-free (like `hold-key-nav.ts`) so the accumulation logic is unit-testable;
// the DOM wiring (non-passive listener + preventDefault) lives in `FilmStrip`.
//
// A scroll is integrated into an accumulator; every `threshold` px of travel
// advances one photo. A small scroll moves one; a faster/longer swipe moves
// several (proportional, Lightroom/iCloud-style), with three guards keeping the
// extremes controlled: a per-event cap, a direction-flip reset, and an idle reset.

/** Px of accumulated scroll delta required to advance one photo. */
const THRESHOLD = 50;
/** Max photos a single wheel event may advance (tames momentum/coalesced spikes). */
const MAX_STEPS_PER_EVENT = 3;
/** Gap (ms) after which a new event starts a fresh gesture (drops stale accumulation). */
const IDLE_RESET_MS = 150;
/** Normalization for non-pixel wheel delta modes (line / page). */
const LINE_PX = 16;
const PAGE_PX = 400;

/** The subset of a DOM `WheelEvent` the stepper reads (a `WheelEvent` satisfies it). */
export type WheelStepEvent = {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  timeStamp: number;
};

export type WheelStepperOptions = {
  /** Advance one photo: +1 = next (scroll down/right), -1 = previous (up/left). */
  onStep: (delta: 1 | -1) => void;
  threshold?: number;
  maxPerEvent?: number;
  idleResetMs?: number;
};

export type WheelStepper = {
  handle: (e: WheelStepEvent) => void;
};

/** Convert a raw wheel delta to px regardless of the event's deltaMode. */
function toPixels(delta: number, mode: number): number {
  if (mode === 1) return delta * LINE_PX; // DOM_DELTA_LINE
  if (mode === 2) return delta * PAGE_PX; // DOM_DELTA_PAGE
  return delta; // DOM_DELTA_PIXEL
}

export function createWheelStepper({
  onStep,
  threshold = THRESHOLD,
  maxPerEvent = MAX_STEPS_PER_EVENT,
  idleResetMs = IDLE_RESET_MS,
}: WheelStepperOptions): WheelStepper {
  let acc = 0;
  let lastTs: number | null = null;

  return {
    handle(e) {
      // Dominant axis: a vertical mouse wheel and a horizontal two-finger swipe
      // both navigate. Pick whichever component is larger this event.
      const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const d = toPixels(raw, e.deltaMode);
      if (d === 0) return;

      // Fresh gesture after an idle gap: discard leftover from a prior flick.
      if (lastTs !== null && e.timeStamp - lastTs > idleResetMs) acc = 0;
      lastTs = e.timeStamp;

      // Reversing direction responds immediately instead of unwinding the accumulator.
      if (acc !== 0 && Math.sign(d) !== Math.sign(acc)) acc = 0;

      acc += d;

      let emitted = 0;
      while (Math.abs(acc) >= threshold && emitted < maxPerEvent) {
        const dir = acc > 0 ? 1 : -1;
        onStep(dir);
        acc -= dir * threshold;
        emitted++;
      }

      // If we stopped because of the per-event cap (still over threshold), discard
      // the excess so a single hard flick / momentum spike can't bank steps that
      // keep firing on later events after the gesture has effectively ended.
      if (Math.abs(acc) >= threshold) acc = 0;
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @lumio/web test src/lib/wheel-step-nav.test.ts`
Expected: PASS — all 10 tests green.

- [ ] **Step 5: Lint the new file**

Run: `pnpm --filter @lumio/web lint src/lib/wheel-step-nav.ts src/lib/wheel-step-nav.test.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/wheel-step-nav.ts apps/web/src/lib/wheel-step-nav.test.ts
git commit -m "feat(film-strip): add pure wheel→step delta accumulator"
```

---

## Task 2: Wire the wheel listener into `FilmStrip` and `Lightbox`

**Files:**
- Modify: `apps/web/src/components/photo-grid/film-strip.tsx`
- Modify: `apps/web/src/components/photo-grid/lightbox.tsx`

No unit test — this is thin DOM wiring (non-passive listener + `preventDefault`), verified by lint, build, and the manual browser check in Task 3, per the spec's testing section.

- [ ] **Step 1: Import the stepper and `useEffect` in `film-strip.tsx`**

The file already imports `useEffect` (line 3: `import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";`) — leave that line as is. Add the stepper import directly below the existing `cn` import (currently line 4):

Existing:
```tsx
import { cn } from "@/lib/utils";
```

Replace with:
```tsx
import { cn } from "@/lib/utils";
import { createWheelStepper } from "@/lib/wheel-step-nav";
```

- [ ] **Step 2: Add the `onStep` prop to `FilmStrip`**

In `film-strip.tsx`, the component signature is:

```tsx
export function FilmStrip({
  items,
  currentId,
  onPick,
}: {
  items: { id: string; index: number }[];
  currentId: string;
  onPick: (index: number) => void;
}) {
```

Replace it with (adds `onStep`):

```tsx
export function FilmStrip({
  items,
  currentId,
  onPick,
  onStep,
}: {
  items: { id: string; index: number }[];
  currentId: string;
  onPick: (index: number) => void;
  /** Advance the active photo by ±1 (wheel/trackpad navigation). */
  onStep: (delta: 1 | -1) => void;
}) {
```

- [ ] **Step 3: Add the latest-`onStep` ref and the non-passive wheel listener effect**

In `film-strip.tsx`, the refs are declared right after the signature:

```tsx
  const viewportRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLButtonElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
```

Immediately after those three lines, add a ref that always points at the latest `onStep` (assigned in a deps-less effect — never during render — per the `react-hooks/refs` rule):

```tsx
  // Keep a ref to the latest onStep so the wheel listener can bind once (below)
  // without re-attaching every render. Assigned in an effect, not during render.
  const onStepRef = useRef(onStep);
  useEffect(() => {
    onStepRef.current = onStep;
  });
```

Then, after the existing resize effect (the block ending at the `}, [sync]);` for the `window.addEventListener("resize", sync)` effect, around line 74), add the wheel-navigation effect:

```tsx
  // Wheel/trackpad over the strip navigates photos (Lightroom/iCloud-style) instead
  // of scrolling thumbnails. The listener must be non-passive to preventDefault the
  // native horizontal scroll — React's synthetic onWheel is passive at the root, so
  // it can't. The strip still follows the active photo via the auto-center effect.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const stepper = createWheelStepper({ onStep: (d) => onStepRef.current(d) });
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stepper.handle(e);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
```

- [ ] **Step 4: Pass `onStep` from `Lightbox` to `FilmStrip`**

In `lightbox.tsx`, `step` is already destructured from the store (line 18: `const { openIndex, photoAt, total, step, close, open } = usePhotoCollection();`) and is typed `(delta: 1 | -1) => void`. The `<FilmStrip>` render is:

```tsx
          {strip.length > 0 && (
            <FilmStrip items={strip} currentId={photo.id} onPick={(i) => open(i)} />
          )}
```

Replace it with (adds `onStep={step}`):

```tsx
          {strip.length > 0 && (
            <FilmStrip
              items={strip}
              currentId={photo.id}
              onPick={(i) => open(i)}
              onStep={step}
            />
          )}
```

- [ ] **Step 5: Lint and build**

Run: `pnpm --filter @lumio/web lint src/components/photo-grid/film-strip.tsx src/components/photo-grid/lightbox.tsx`
Expected: no errors (in particular no `react-hooks/refs` violation — `onStepRef.current` is only read inside the wheel handler / written inside an effect, never during render).

Run: `pnpm --filter @lumio/web test`
Expected: the whole web suite passes (no regressions from the `FilmStrip` prop change).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/photo-grid/film-strip.tsx apps/web/src/components/photo-grid/lightbox.tsx
git commit -m "feat(film-strip): scroll over the strip to navigate photos"
```

---

## Task 3: Manual browser verification

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server (if not already running)**

Run: `pnpm dev` (serves `@lumio/web`). Open the library, click a photo to open the lightbox so the film strip is visible.

- [ ] **Step 2: Verify the behaviors**

Confirm each, ideally with both a trackpad and a mouse wheel:
- Scrolling over the film strip changes the main photo (not just the thumbnails).
- Direction: scroll **down or right → next**, **up or left → previous**.
- A small scroll moves **one** photo; a faster/longer swipe moves **several**.
- Trackpad momentum does **not** keep flying through photos after you stop — it settles.
- The strip **auto-centers** on the active thumbnail as you scrub.
- Stepping **stops cleanly** at the first and last photo (no errors, no runaway).
- Thumbnail click, arrow keys, arrow buttons, and **dragging the custom scrollbar**
  (which still scrolls the strip without changing the photo) all still work.

- [ ] **Step 3: Note any feel adjustments**

If the feel is off, tune the constants at the top of `apps/web/src/lib/wheel-step-nav.ts`
(`THRESHOLD` for photos-per-scroll-distance, `MAX_STEPS_PER_EVENT` for the per-event cap,
`IDLE_RESET_MS` for how quickly a stopped gesture clears) and re-verify. These are the only
knobs; the unit tests pass explicit values, so changing the defaults won't break them.

---

## Self-Review

**Spec coverage:**
- Wheel/trackpad over strip steps the photo → Task 1 (stepper) + Task 2 (wiring). ✓
- Proportional feel with controlled extremes → accumulator + `MAX_STEPS_PER_EVENT` + capped-excess discard (Task 1). ✓
- Both mouse wheel (vertical) and trackpad (horizontal) → dominant-axis selection + `deltaMode` normalization (Task 1, tested). ✓
- Direction down/right = next, up/left = prev → sign of accumulator → `onStep(±1)` → `step` (Tasks 1–2, tested). ✓
- Strip follows the active photo → reuses the existing auto-center effect, no change (noted in Task 2). ✓
- Film-strip only (non-goal: main image) → listener attached only to `viewportRef` (Task 2). ✓
- No store change / reuse `step` → `onStep={step}` (Task 2). ✓
- Clamps at ends → `step` is already a clamped no-op; verified in Task 3. ✓
- Non-passive listener required → Task 2 Step 3 + comment. ✓
- Testing: unit tests for the pure stepper, manual for DOM wiring → Tasks 1 and 3 match the spec's testing section. ✓

**Placeholder scan:** none — every code step shows complete code; commands have expected output.

**Type consistency:** `onStep: (delta: 1 | -1) => void` is identical across the stepper option, the `FilmStrip` prop, and the store's `step`. `WheelStepEvent` is created in the test and consumed by `handle`; a real `WheelEvent` satisfies it structurally in Task 2. `createWheelStepper` / `WheelStepEvent` / `WheelStepper` names match between module, test, and import.
