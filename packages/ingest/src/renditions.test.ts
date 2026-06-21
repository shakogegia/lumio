import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { buildRenditions } from "./renditions.js";

// A 4x2 PNG (landscape). No EXIF orientation.
async function landscape(): Promise<Buffer> {
  return sharp({ create: { width: 4, height: 2, channels: 3, background: { r: 1, g: 2, b: 3 } } })
    .png()
    .toBuffer();
}

describe("buildRenditions", () => {
  it("keeps dimensions with no edits", async () => {
    const r = await buildRenditions(await landscape(), null);
    expect([r.width, r.height]).toEqual([4, 2]);
    expect(r.display.length).toBeGreaterThan(0);
    expect(r.thumbnail.length).toBeGreaterThan(0);
    expect(typeof r.thumbhash).toBe("string");
  });

  it("swaps dimensions on a 90° rotation", async () => {
    const r = await buildRenditions(await landscape(), { rotate: 90, flipH: false, flipV: false });
    expect([r.width, r.height]).toEqual([2, 4]);
  });

  it("keeps dimensions on 180° rotation", async () => {
    const r = await buildRenditions(await landscape(), { rotate: 180, flipH: false, flipV: false });
    expect([r.width, r.height]).toEqual([4, 2]);
  });
});

describe("buildRenditions crop & straighten", () => {
  it("crops to the requested fraction (dimensions follow the crop)", async () => {
    const img = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 9, g: 9, b: 9 } },
    }).png().toBuffer();
    const r = await buildRenditions(img, {
      rotate: 0, flipH: false, flipV: false, straighten: 0,
      crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
    });
    expect(r.width).toBe(50);
    expect(r.height).toBe(50);
    const meta = await sharp(r.display).metadata();
    expect(meta.channels).toBe(3);
  });

  it("straighten with no explicit crop auto-fills (no empty corners)", async () => {
    const img = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 9, g: 9, b: 9 } },
    }).png().toBuffer();
    const r = await buildRenditions(img, {
      rotate: 0, flipH: false, flipV: false, straighten: 45, crop: null,
    });
    // A 100x100 rotated 45° auto-crops to its inscribed 1:1 rect (side ≈ 71),
    // NOT the 141x141 bounding box — straightening never leaves empty corners.
    expect(r.width).toBeLessThan(100);
    expect(r.width).toBeGreaterThan(55);
    expect(Math.abs(r.width - r.height)).toBeLessThanOrEqual(2);
    const meta = await sharp(r.display).metadata();
    expect(meta.channels).toBe(3);
  });

  it("no-edits path is unchanged", async () => {
    const img = await sharp({
      create: { width: 4, height: 2, channels: 3, background: { r: 1, g: 2, b: 3 } },
    }).png().toBuffer();
    const r = await buildRenditions(img, null);
    expect([r.width, r.height]).toEqual([4, 2]);
  });
});

