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
