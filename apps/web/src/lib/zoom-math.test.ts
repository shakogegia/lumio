import { describe, expect, it } from "vitest";
import {
  clampOffset,
  clampZoom,
  computeFitZoom,
  computeStops,
  MAX_ZOOM,
  nextStop,
  prevStop,
  scaledSize,
  zoomToward,
} from "./zoom-math";

describe("computeFitZoom", () => {
  it("scales a large photo down to fit (below 100)", () => {
    expect(computeFitZoom({ width: 6000, height: 4000 }, { width: 1200, height: 800 })).toBeCloseTo(20);
  });
  it("never upscales a small photo past 100", () => {
    expect(computeFitZoom({ width: 400, height: 300 }, { width: 1200, height: 800 })).toBe(100);
  });
  it("is limited by the tighter axis", () => {
    expect(computeFitZoom({ width: 1000, height: 4000 }, { width: 1000, height: 1000 })).toBeCloseTo(25);
  });
  it("returns 100 when the viewport is unmeasured", () => {
    expect(computeFitZoom({ width: 6000, height: 4000 }, { width: 0, height: 0 })).toBe(100);
  });
});

describe("clampZoom", () => {
  it("clamps below fit up to fit", () => {
    expect(clampZoom(10, 20)).toBe(20);
  });
  it("clamps above max down to 400", () => {
    expect(clampZoom(900, 20)).toBe(MAX_ZOOM);
  });
  it("passes through a value in range", () => {
    expect(clampZoom(150, 20)).toBe(150);
  });
});

describe("computeStops", () => {
  it("includes fit then every 100-step strictly above it", () => {
    expect(computeStops(20)).toEqual([20, 100, 200, 300, 400]);
  });
  it("drops stops at or below fit", () => {
    expect(computeStops(100)).toEqual([100, 200, 300, 400]);
    expect(computeStops(250)).toEqual([250, 300, 400]);
  });
});

describe("nextStop / prevStop", () => {
  const stops = [20, 100, 200, 300, 400];
  it("advances to the next stop above the current zoom", () => {
    expect(nextStop(20, stops)).toBe(100);
    expect(nextStop(100, stops)).toBe(200);
    expect(nextStop(150, stops)).toBe(200);
  });
  it("caps at the top stop", () => {
    expect(nextStop(400, stops)).toBe(400);
  });
  it("retreats to the previous stop below the current zoom", () => {
    expect(prevStop(400, stops)).toBe(300);
    expect(prevStop(100, stops)).toBe(20);
    expect(prevStop(150, stops)).toBe(100);
  });
  it("floors at fit", () => {
    expect(prevStop(20, stops)).toBe(20);
  });
});

describe("scaledSize", () => {
  it("is the photo size at 100%", () => {
    expect(scaledSize({ width: 6000, height: 4000 }, 100)).toEqual({ width: 6000, height: 4000 });
  });
  it("halves at 50%", () => {
    expect(scaledSize({ width: 6000, height: 4000 }, 50)).toEqual({ width: 3000, height: 2000 });
  });
});

describe("clampOffset", () => {
  const viewport = { width: 1000, height: 800 };
  it("limits panning to the scaled image's overflow on each side", () => {
    const scaled = { width: 2000, height: 800 };
    expect(clampOffset({ x: 999, y: 50 }, scaled, viewport)).toEqual({ x: 500, y: 0 });
    expect(clampOffset({ x: -999, y: -50 }, scaled, viewport)).toEqual({ x: -500, y: 0 });
  });
  it("locks an axis to 0 when the image is smaller than the viewport there", () => {
    const scaled = { width: 600, height: 600 };
    expect(clampOffset({ x: 100, y: 100 }, scaled, viewport)).toEqual({ x: 0, y: 0 });
  });
});

describe("zoomToward", () => {
  it("keeps the centered point fixed when anchored at center", () => {
    expect(zoomToward({ x: 0, y: 0 }, 100, 200, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });
  it("shifts the offset so the cursor point stays under the cursor", () => {
    // offset' = c - (to/from)(c - offset) = 100 - 2*(100 - 0) = -100
    expect(zoomToward({ x: 100, y: 0 }, 100, 200, { x: 0, y: 0 })).toEqual({ x: -100, y: 0 });
  });
  it("is symmetric when zooming back out", () => {
    expect(zoomToward({ x: 100, y: 0 }, 200, 100, { x: -100, y: 0 })).toEqual({ x: 0, y: 0 });
  });
});
