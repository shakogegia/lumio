import { describe, it, expect } from "vitest";
import { nextZoomLevel, stepInColumns } from "./zoom";

const LEVELS = [1, 3, 5, 8]; // ascending column counts; lower index = bigger tiles

describe("nextZoomLevel", () => {
  it("zooms in (fewer columns) on a pinch-out past threshold", () => {
    expect(nextZoomLevel(LEVELS, 2, 1.5)).toBe(1);
  });
  it("zooms out (more columns) on a pinch-in past threshold", () => {
    expect(nextZoomLevel(LEVELS, 1, 0.5)).toBe(2);
  });
  it("stays put inside the dead zone", () => {
    expect(nextZoomLevel(LEVELS, 1, 1.0)).toBe(1);
  });
  it("clamps at the smallest-columns end (index 0)", () => {
    expect(nextZoomLevel(LEVELS, 0, 3)).toBe(0);
  });
  it("clamps at the most-columns end (last index)", () => {
    expect(nextZoomLevel(LEVELS, 3, 0.2)).toBe(3);
  });
});

describe("stepInColumns", () => {
  it("steps to the next-fewer column count", () => {
    expect(stepInColumns(LEVELS, 8)).toBe(5);
    expect(stepInColumns(LEVELS, 5)).toBe(3);
    expect(stepInColumns(LEVELS, 3)).toBe(1);
  });
  it("stays at the fewest-columns level", () => {
    expect(stepInColumns(LEVELS, 1)).toBe(1);
  });
});
