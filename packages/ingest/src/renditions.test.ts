import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { buildRenditions, encodeEditedJpeg } from "./renditions.js";

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

describe("buildRenditions color", () => {
  const grey = () =>
    sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 100, g: 100, b: 100 } } })
      .png()
      .toBuffer();

  it("brightens with a color-only recipe and keeps dimensions", async () => {
    const base = await buildRenditions(await grey(), null);
    const bright = await buildRenditions(await grey(), {
      rotate: 0, flipH: false, flipV: false, brightness: 80,
    });
    const m0 = (await sharp(base.display).stats()).channels[0]!.mean;
    const m1 = (await sharp(bright.display).stats()).channels[0]!.mean;
    expect(m1).toBeGreaterThan(m0);
    expect([bright.width, bright.height]).toEqual([16, 16]);
  });

  it("vignette darkens the corner more than the center", async () => {
    const white = await sharp({
      create: { width: 48, height: 48, channels: 3, background: { r: 255, g: 255, b: 255 } },
    }).png().toBuffer();
    const r = await buildRenditions(white, { rotate: 0, flipH: false, flipV: false, vignette: 100 });
    const { data, info } = await sharp(r.display).raw().toBuffer({ resolveWithObject: true });
    const lum = (x: number, y: number) => data[(y * info.width + x) * info.channels];
    const corner = lum(0, 0)!;
    const center = lum(Math.floor(info.width / 2), Math.floor(info.height / 2))!;
    expect(center).toBeGreaterThan(corner + 20);
  });

  it("composes geometry and color (crop dims + brighter pixels)", async () => {
    const img = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 100, g: 100, b: 100 } },
    }).png().toBuffer();
    const r = await buildRenditions(img, {
      rotate: 0, flipH: false, flipV: false,
      crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, brightness: 80,
    });
    expect([r.width, r.height]).toEqual([50, 50]);
    const mean = (await sharp(r.display).stats()).channels[0]!.mean;
    expect(mean).toBeGreaterThan(150);
  });

  it("encodeEditedJpeg applies a color-only recipe", async () => {
    const plain = await encodeEditedJpeg(await grey(), null);
    const bright = await encodeEditedJpeg(await grey(), {
      rotate: 0, flipH: false, flipV: false, brightness: 80,
    });
    const m0 = (await sharp(plain).stats()).channels[0]!.mean;
    const m1 = (await sharp(bright).stats()).channels[0]!.mean;
    expect(m1).toBeGreaterThan(m0);
  });
});

