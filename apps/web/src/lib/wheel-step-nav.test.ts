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
