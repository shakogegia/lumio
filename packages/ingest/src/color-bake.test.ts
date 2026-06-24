import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { applyColorBake } from "./color-bake.js";

/** Mean of channel 0 over a baked sharp pipeline. */
async function meanR(img: sharp.Sharp): Promise<number> {
  return (await img.stats()).channels[0]!.mean;
}

function grey(v = 100, w = 16, h = 16): sharp.Sharp {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: v, g: v, b: v } } });
}

describe("applyColorBake", () => {
  it("no-op for a recipe with no color", async () => {
    const out = await applyColorBake(grey(), { rotate: 0, flipH: false, flipV: false });
    expect(await meanR(out)).toBeCloseTo(100, 0);
  });

  it("exposure (EV, linear light) raises the mean", async () => {
    const out = await applyColorBake(grey(), { rotate: 0, flipH: false, flipV: false, exposure: 2 });
    expect(await meanR(out)).toBeGreaterThan(150);
  });

  it("saturation -100 produces grey (channels equal)", async () => {
    const src = sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 60, b: 20 } } });
    const out = await applyColorBake(src, { rotate: 0, flipH: false, flipV: false, saturation: -100 });
    const stats = (await out.stats()).channels;
    expect(Math.abs(stats[0]!.mean - stats[1]!.mean)).toBeLessThan(1);
    expect(Math.abs(stats[1]!.mean - stats[2]!.mean)).toBeLessThan(1);
  });

  it("shadows+ lifts a dark image", async () => {
    const out = await applyColorBake(grey(40), { rotate: 0, flipH: false, flipV: false, shadows: 100 });
    expect(await meanR(out)).toBeGreaterThan(40);
  });

  it("a master curve that raises midtones brightens a mid-grey", async () => {
    const out = await applyColorBake(grey(128), {
      rotate: 0, flipH: false, flipV: false,
      curves: { master: [{ x: 0, y: 0 }, { x: 0.5, y: 0.75 }, { x: 1, y: 1 }] },
    });
    expect(await meanR(out)).toBeGreaterThan(140);
  });

  it("preserves dimensions and channel count", async () => {
    const out = await applyColorBake(grey(100, 12, 9), { rotate: 0, flipH: false, flipV: false, contrast: 50 });
    const meta = await out.png().toBuffer().then((b) => sharp(b).metadata());
    expect([meta.width, meta.height]).toEqual([12, 9]);
    expect(meta.channels).toBe(3);
  });
});
