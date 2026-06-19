import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { computeThumbhash } from "./thumbhash.js";

describe("computeThumbhash", () => {
  it("returns a short base64 hash for an image buffer", async () => {
    const img = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 30, b: 30 } },
    })
      .webp()
      .toBuffer();
    const hash = await computeThumbhash(img);
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
    expect(hash.length).toBeLessThan(60);
    expect(await computeThumbhash(img)).toBe(hash);
  });
});
