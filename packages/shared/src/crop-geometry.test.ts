import { describe, expect, it } from "vitest";
import {
  straightenedSize,
  pointOnImage,
  clampCropToImage,
  centeredAspectCrop,
  cropToExtract,
} from "./crop-geometry.js";

describe("crop-geometry", () => {
  it("straightenedSize is identity at 0° and grows the bbox at an angle", () => {
    expect(straightenedSize(400, 200, 0)).toEqual({ w: 400, h: 200 });
    const r = straightenedSize(400, 200, 90);
    expect(r.w).toBeCloseTo(200, 4);
    expect(r.h).toBeCloseTo(400, 4);
    const t = straightenedSize(100, 100, 45);
    expect(t.w).toBeCloseTo(Math.SQRT2 * 100, 3);
  });

  it("pointOnImage: center is always on, far corner of O′ is off when tilted", () => {
    expect(pointOnImage(0.5, 0.5, 400, 200, 30)).toBe(true);
    expect(pointOnImage(0, 0, 400, 200, 30)).toBe(false);
  });

  it("clampCropToImage leaves an in-bounds crop unchanged at 0°", () => {
    const c = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
    expect(clampCropToImage(c, 400, 200, 0)).toEqual(c);
  });

  it("clampCropToImage shrinks a full crop when tilted (corners would be empty)", () => {
    const full = { x: 0, y: 0, w: 1, h: 1 };
    const out = clampCropToImage(full, 400, 200, 20);
    expect(out.w).toBeLessThan(1);
    expect(out.h).toBeLessThan(1);
    expect(out.x + out.w / 2).toBeCloseTo(0.5, 3);
    expect(out.y + out.h / 2).toBeCloseTo(0.5, 3);
  });

  it("centeredAspectCrop produces a centered rect of the requested aspect", () => {
    const c = centeredAspectCrop(1, 400, 200, 0);
    expect(c.w * 400).toBeCloseTo(200, 2);
    expect(c.h * 200).toBeCloseTo(200, 2);
    expect(c.x + c.w / 2).toBeCloseTo(0.5, 4);
    expect(c.y + c.h / 2).toBeCloseTo(0.5, 4);
  });

  it("centeredAspectCrop tilted: square fit equals the inscribed-square side, centered", () => {
    const c = centeredAspectCrop(1, 400, 200, 45);
    // Inscribed square in a 45°-tilted 400×200 image has side 100·√2 px.
    expect(c.w * straightenedSize(400, 200, 45).w).toBeCloseTo(100 * Math.SQRT2, 0);
    expect(c.x + c.w / 2).toBeCloseTo(0.5, 3);
    expect(c.y + c.h / 2).toBeCloseTo(0.5, 3);
  });

  it("cropToExtract maps a centered normalized crop to pixels", () => {
    expect(cropToExtract({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, 100, 100)).toEqual({
      left: 25,
      top: 25,
      width: 50,
      height: 50,
    });
  });

  it("cropToExtract covers the full frame", () => {
    expect(cropToExtract({ x: 0, y: 0, w: 1, h: 1 }, 100, 80)).toEqual({
      left: 0,
      top: 0,
      width: 100,
      height: 80,
    });
  });

  it("cropToExtract clamps a near-edge crop inside the canvas", () => {
    const e = cropToExtract({ x: 0.95, y: 0.95, w: 0.2, h: 0.2 }, 100, 100);
    expect(e.left + e.width).toBeLessThanOrEqual(100);
    expect(e.top + e.height).toBeLessThanOrEqual(100);
    expect(e.width).toBeGreaterThanOrEqual(1);
    expect(e.height).toBeGreaterThanOrEqual(1);
  });
});
