import { describe, it, expect } from "vitest";
import { clampOffset } from "./zoom-math";

describe("clampOffset", () => {
  it("pins to 0 at scale 1 (no pan room)", () => {
    expect(clampOffset(40, 1, 100)).toBe(0);
  });
  it("clamps within +/- (scale-1)*dimension/2", () => {
    // scale 2, dim 100 -> max 50
    expect(clampOffset(80, 2, 100)).toBe(50);
    expect(clampOffset(-80, 2, 100)).toBe(-50);
    expect(clampOffset(10, 2, 100)).toBe(10);
  });
});
