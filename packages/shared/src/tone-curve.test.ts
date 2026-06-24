import { describe, expect, it } from "vitest";
import { sampleCurve, type CurvePoint } from "./tone-curve.js";

describe("sampleCurve", () => {
  it("identity when fewer than two points", () => {
    const lut = sampleCurve([], 256);
    expect(lut[0]).toBeCloseTo(0, 5);
    expect(lut[255]).toBeCloseTo(1, 5);
    expect(lut[128]).toBeCloseTo(128 / 255, 2);
    expect(sampleCurve([{ x: 0.5, y: 0.9 }], 256)[200]).toBeCloseTo(200 / 255, 2);
  });

  it("passes through control points and stays monotone non-decreasing", () => {
    const pts: CurvePoint[] = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.7 },
      { x: 1, y: 1 },
    ];
    const lut = sampleCurve(pts, 256);
    expect(lut[128]).toBeGreaterThan(0.6); // near the (0.5, 0.7) control point
    for (let i = 1; i < 256; i++) expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1]! - 1e-6);
  });

  it("clamps output to [0,1] even with out-of-range control points", () => {
    const lut = sampleCurve([{ x: 0, y: 0 }, { x: 0.5, y: 1.5 }, { x: 1, y: 1 }], 256);
    for (const v of lut) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("holds flat beyond the outermost control points", () => {
    const lut = sampleCurve([{ x: 0.25, y: 0.4 }, { x: 0.75, y: 0.6 }], 256);
    expect(lut[0]).toBeCloseTo(0.4, 5); // x below first point → first y
    expect(lut[255]).toBeCloseTo(0.6, 5); // x above last point → last y
  });
});
