import { describe, it, expect, vi } from "vitest";
import { createHoldStepper, type HoldTarget } from "./hold-key-nav";

function setup() {
  const step = vi.fn();
  // Simulate a list of 5 photos (indices 0..4); `pos` is the current index.
  let pos = 2;
  let tickFn: (() => void) | null = null;
  const target: HoldTarget = {
    canStep: (dir) => (dir === "next" ? pos < 4 : pos > 0),
    step: (dir) => {
      step(dir);
      pos += dir === "next" ? 1 : -1;
    },
  };
  const stepper = createHoldStepper({
    getTarget: () => target,
    schedule: (fn) => {
      tickFn = fn;
      return () => {
        tickFn = null;
      };
    },
  });
  return { stepper, step, tick: () => tickFn?.(), isScheduled: () => tickFn !== null };
}

describe("createHoldStepper", () => {
  it("steps once immediately on press and schedules repeats", () => {
    const s = setup();
    s.stepper.press("next");
    expect(s.step).toHaveBeenCalledTimes(1);
    expect(s.step).toHaveBeenLastCalledWith("next");
    expect(s.isScheduled()).toBe(true);
  });

  it("keeps stepping while held and stops at the end of the list", () => {
    const s = setup(); // starts at index 2 of 0..4
    s.stepper.press("next"); // 2 -> 3
    s.tick();                // 3 -> 4
    s.tick();                // at end: canStep('next') is false, no further step
    s.tick();
    expect(s.step).toHaveBeenCalledTimes(2);
  });

  it("release stops the loop", () => {
    const s = setup();
    s.stepper.press("next");
    s.stepper.release("next");
    expect(s.isScheduled()).toBe(false);
  });
});
