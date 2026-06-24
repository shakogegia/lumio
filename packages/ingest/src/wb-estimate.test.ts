import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { estimateAsShotFromImage } from "./wb-estimate.js";

const solid = (r: number, g: number, b: number) =>
  sharp({ create: { width: 32, height: 32, channels: 3, background: { r, g, b } } }).webp().toBuffer();

describe("estimateAsShotFromImage", () => {
  it("estimates ≈ neutral for a grey image", async () => {
    const wb = (await estimateAsShotFromImage(await solid(128, 128, 128)))!;
    expect(wb).not.toBeNull();
    expect(wb.k).toBeGreaterThan(6000);
    expect(wb.k).toBeLessThan(7000);
  });

  it("estimates a low K for a warm image and handles RGBA", async () => {
    const png = await sharp({ create: { width: 16, height: 16, channels: 4, background: { r: 190, g: 140, b: 90, alpha: 1 } } }).png().toBuffer();
    const wb = (await estimateAsShotFromImage(png))!;
    expect(wb.k).toBeLessThan(5500);
  });
});
