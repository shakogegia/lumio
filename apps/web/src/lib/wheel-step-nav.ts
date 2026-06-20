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
