import { describe, it, expect, vi } from "vitest";
import { createHoldStepper, type HoldTarget } from "./hold-key-nav";

/**
 * Drive the stepper with a manual ticker instead of a real timer, and a
 * swappable target so a test can simulate the page remounting (which replaces
 * the target with the next photo's neighbours) between ticks.
 */
function setup(initial: HoldTarget | null) {
  const navigate = vi.fn();
  let current = initial;
  let tickFn: (() => void) | null = null;

  const stepper = createHoldStepper({
    getTarget: () => current,
    schedule: (fn) => {
      tickFn = fn;
      return () => {
        tickFn = null;
      };
    },
  });

  return {
    stepper,
    navigate,
    tick: () => tickFn?.(),
    isScheduled: () => tickFn !== null,
    /** Simulate a navigation landing: the page now shows `photo`. */
    showPhoto: (prevHref: string | null, nextHref: string | null) => {
      current = { prevHref, nextHref, navigate };
    },
    clearTarget: () => {
      current = null;
    },
  };
}

describe("createHoldStepper", () => {
  it("navigates once immediately on press", () => {
    const s = setup(null);
    s.showPhoto("/p/a", "/p/c");
    s.stepper.press("next");
    expect(s.navigate).toHaveBeenCalledTimes(1);
    expect(s.navigate).toHaveBeenLastCalledWith("/p/c");
    expect(s.isScheduled()).toBe(true);
  });

  it("keeps advancing while held even though each navigation swaps the target (the remount bug)", () => {
    // Start on photo B; neighbours are A (prev) and C (next).
    const s = setup(null);
    s.showPhoto("/p/a", "/p/c");

    s.stepper.press("next"); // B -> C immediately
    expect(s.navigate).toHaveBeenNthCalledWith(1, "/p/c");

    // The navigation lands and the component remounts on photo C (a new target).
    s.showPhoto("/p/b", "/p/d");
    s.tick(); // C -> D
    expect(s.navigate).toHaveBeenNthCalledWith(2, "/p/d");

    // …and again on photo D.
    s.showPhoto("/p/c", "/p/e");
    s.tick(); // D -> E
    expect(s.navigate).toHaveBeenNthCalledWith(3, "/p/e");

    expect(s.navigate).toHaveBeenCalledTimes(3);
  });

  it("does not re-fire the same navigation while the target hasn't advanced yet", () => {
    const s = setup(null);
    s.showPhoto("/p/a", "/p/c");
    s.stepper.press("next"); // -> C
    expect(s.navigate).toHaveBeenCalledTimes(1);

    // Tick before the remount lands: target still points at the old photo.
    s.tick();
    s.tick();
    expect(s.navigate).toHaveBeenCalledTimes(1); // no duplicate nav to /p/c
  });

  it("stops on release: no further steps and the schedule is cancelled", () => {
    const s = setup(null);
    s.showPhoto("/p/a", "/p/c");
    s.stepper.press("next");
    expect(s.isScheduled()).toBe(true);

    s.stepper.release("next");
    expect(s.isScheduled()).toBe(false);
    expect(s.stepper.held()).toBe(null);

    s.showPhoto("/p/b", "/p/d");
    s.tick(); // ticker is detached, but call it anyway — must be a no-op
    expect(s.navigate).toHaveBeenCalledTimes(1);
  });

  it("releasing the other direction does not stop the current hold", () => {
    const s = setup(null);
    s.showPhoto("/p/a", "/p/c");
    s.stepper.press("next");
    s.stepper.release("prev"); // unrelated key up
    expect(s.stepper.held()).toBe("next");
    expect(s.isScheduled()).toBe(true);
  });

  it("does nothing at an end (no neighbour in that direction)", () => {
    const s = setup(null);
    s.showPhoto("/p/a", null); // last photo, no next
    s.stepper.press("next");
    expect(s.navigate).not.toHaveBeenCalled();
    // Still holding/scheduled, so it resumes if a neighbour appears.
    expect(s.isScheduled()).toBe(true);
  });

  it("stop() halts an in-progress hold", () => {
    const s = setup(null);
    s.showPhoto("/p/a", "/p/c");
    s.stepper.press("next");
    s.stepper.stop();
    expect(s.stepper.held()).toBe(null);
    expect(s.isScheduled()).toBe(false);
  });
});
