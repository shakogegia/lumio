import { describe, expect, it } from "vitest";
import {
  straightenedSize,
  pointOnImage,
  clampCropToImage,
  centeredAspectCrop,
  cropToExtract,
  cropOnImage,
  maxValidAdvance,
  constrainCropDrag,
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

describe("interactive crop drag constraints", () => {
  it("cropOnImage: full frame on at 0°, off when tilted, small centered crop on", () => {
    expect(cropOnImage({ x: 0, y: 0, w: 1, h: 1 }, 400, 200, 0)).toBe(true);
    expect(cropOnImage({ x: 0, y: 0, w: 1, h: 1 }, 400, 200, 20)).toBe(false);
    expect(cropOnImage({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, 400, 200, 20)).toBe(true);
  });

  it("maxValidAdvance returns the target unchanged when it is already on-image", () => {
    const from = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
    const to = { x: 0.2, y: 0.2, w: 0.3, h: 0.3 };
    expect(maxValidAdvance(from, to, 400, 200, 0)).toEqual(to);
  });

  it("maxValidAdvance pins an overshooting east edge at the boundary (anchor + height kept)", () => {
    const from = { x: 0.1, y: 0.1, w: 0.3, h: 0.3 };
    const to = { x: 0.1, y: 0.1, w: 1.2, h: 0.3 }; // east edge way off the image
    const out = maxValidAdvance(from, to, 400, 200, 0);
    expect(out.x).toBeCloseTo(0.1, 4); // west anchor fixed
    expect(out.y).toBeCloseTo(0.1, 4);
    expect(out.h).toBeCloseTo(0.3, 4); // height unchanged — no center shrink
    expect(out.x + out.w).toBeCloseTo(1, 3); // east pinned to the image edge
  });

  it("maxValidAdvance pins a move at the corner without changing size", () => {
    const from = { x: 0.6, y: 0.6, w: 0.3, h: 0.3 };
    const to = { x: 1.0, y: 1.0, w: 0.3, h: 0.3 }; // translated past the corner
    const out = maxValidAdvance(from, to, 400, 200, 0);
    expect(out.w).toBeCloseTo(0.3, 4);
    expect(out.h).toBeCloseTo(0.3, 4);
    expect(out.x + out.w).toBeCloseTo(1, 3);
    expect(out.y + out.h).toBeCloseTo(1, 3);
  });
});

describe("constrainCropDrag", () => {
  it("move: pins at the image edge and never shrinks", () => {
    const start = { x: 0.6, y: 0.1, w: 0.3, h: 0.3 };
    const next = { x: 1.0, y: 0.1, w: 0.3, h: 0.3 }; // dragged right, overshoots
    const out = constrainCropDrag(start, next, 400, 200, 0, { move: true });
    expect(out.w).toBeCloseTo(0.3, 4); // size unchanged
    expect(out.h).toBeCloseTo(0.3, 4);
    expect(out.x + out.w).toBeCloseTo(1, 3); // pinned at the right edge
  });

  it("free edge resize: east edge stops at the boundary, west anchor fixed", () => {
    const start = { x: 0.1, y: 0.1, w: 0.3, h: 0.3 };
    const next = { x: 0.1, y: 0.1, w: 1.0, h: 0.3 };
    const out = constrainCropDrag(start, next, 400, 200, 0, {});
    expect(out.x).toBeCloseTo(0.1, 4);
    expect(out.x + out.w).toBeCloseTo(1, 3);
    expect(out.h).toBeCloseTo(0.3, 4);
  });

  it("free corner resize: each edge slides to its own boundary (decoupled, no center shrink)", () => {
    const start = { x: 0.2, y: 0.5, w: 0.2, h: 0.2 }; // anchor nw = (0.2, 0.5)
    const next = { x: 0.2, y: 0.5, w: 1.0, h: 1.0 }; // both edges overshoot
    const out = constrainCropDrag(start, next, 400, 200, 0, {});
    expect(out.x).toBeCloseTo(0.2, 4); // nw anchor fixed
    expect(out.y).toBeCloseTo(0.5, 4);
    expect(out.x + out.w).toBeCloseTo(1, 3); // east pinned
    expect(out.y + out.h).toBeCloseTo(1, 3); // south pinned
    // Width reaches the right edge even though height was capped sooner — a
    // center-shrink would have shrunk the width too.
    expect(out.w).toBeCloseTo(0.8, 3);
    expect(out.h).toBeCloseTo(0.5, 3);
  });

  it("aspect-locked resize: scales uniformly to fit (ratio preserved, not decoupled)", () => {
    const start = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }; // 1:1
    const next = { x: 0.1, y: 0.1, w: 1.2, h: 1.2 }; // still 1:1, overshoots
    const out = constrainCropDrag(start, next, 400, 200, 0, { aspectLocked: true });
    expect(out.w / out.h).toBeCloseTo(1, 3); // ratio preserved
    expect(out.x).toBeCloseTo(0.1, 4);
    expect(out.x + out.w).toBeCloseTo(1, 3);
    expect(out.y + out.h).toBeCloseTo(1, 3);
  });

  it("degenerate start (off-image while tilted) falls back to the center-shrink clamp", () => {
    const start = { x: 0, y: 0, w: 1, h: 1 }; // full frame, off-image at 20°
    const next = { x: 0, y: 0, w: 1, h: 1 };
    const out = constrainCropDrag(start, next, 400, 200, 20, { move: true });
    expect(out.w).toBeLessThan(1); // shrunk about center (fallback path)
    expect(out.x + out.w / 2).toBeCloseTo(0.5, 3);
  });
});
