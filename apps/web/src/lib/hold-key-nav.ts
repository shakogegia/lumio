// Press-and-hold arrow-key navigation between photos. `createHoldStepper` is a
// pure, DOM-free state machine: `press(dir)` steps once immediately, then keeps
// stepping on the injected `schedule` cadence until `release`/`stop`. Each tick
// reads the *current* target and respects `canStep`, so it stops cleanly at the
// ends of the list. The DOM/keyboard wiring lives in the Lightbox component.

/** Cadence for press-and-hold stepping (~7 photos/second). */
export const HOLD_STEP_MS = 140;

export type HoldDirection = "prev" | "next";

export type HoldTarget = {
  /** Whether a step in this direction is currently possible (not at an edge). */
  canStep: (dir: HoldDirection) => boolean;
  /** Advance one photo in `dir` (client state change). */
  step: (dir: HoldDirection) => void;
};

export type HoldStepperOptions = {
  /** Latest target, or null when nothing is navigable (e.g. modal closed). */
  getTarget: () => HoldTarget | null;
  /**
   * Start invoking `fn` at the hold cadence and return a cancel function.
   * Injected (rather than calling setInterval directly) so the state machine
   * stays DOM-free and can be driven deterministically in tests.
   */
  schedule: (fn: () => void) => () => void;
};

export type HoldStepper = {
  press: (dir: HoldDirection) => void;
  release: (dir: HoldDirection) => void;
  stop: () => void;
  held: () => HoldDirection | null;
};

/**
 * Press-and-hold navigation state machine — framework- and DOM-free so it can
 * be unit-tested. `press` steps once immediately, then keeps stepping on the
 * injected schedule until the matching `release` (or `stop`). Each step reads
 * the *current* target, so it keeps advancing correctly even though every
 * navigation swaps the target out from under it.
 */
export function createHoldStepper({
  getTarget,
  schedule,
}: HoldStepperOptions): HoldStepper {
  let dir: HoldDirection | null = null;
  let cancel: (() => void) | null = null;

  const tick = () => {
    if (!dir) return;
    const target = getTarget();
    if (!target || !target.canStep(dir)) return;
    target.step(dir);
  };

  const stop = () => {
    dir = null;
    if (cancel) {
      cancel();
      cancel = null;
    }
  };

  return {
    press(next) {
      if (dir === next) return;
      dir = next;
      tick();
      if (cancel) cancel();
      cancel = schedule(tick);
    },
    release(which) {
      if (dir === which) stop();
    },
    stop,
    held: () => dir,
  };
}
