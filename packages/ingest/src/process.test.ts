import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { processImage } from "./process.js";

const dir = await mkdtemp(path.join(tmpdir(), "lumio-proc-"));
const fixture = path.join(dir, "fixture.jpg");

await sharp({ create: { width: 320, height: 240, channels: 3, background: "#123456" } })
  .withExif({
    IFD0: { Make: "Lumio", Model: "FixtureCam" },
    IFD2: {
      DateTimeOriginal: "2024:03:14 09:26:53",
      FNumber: "28/10",
      ISOSpeedRatings: "400",
      FocalLength: "50/1",
    },
  })
  .jpeg()
  .toFile(fixture);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("processImage", () => {
  it("extracts dimensions, EXIF, a thumbnail and a stable hash", async () => {
    const result = await processImage(fixture);

    expect(result.width).toBe(320);
    expect(result.height).toBe(240);
    expect(result.exif.cameraMake).toBe("Lumio");
    expect(result.exif.cameraModel).toBe("FixtureCam");
    expect(result.exif.FNumber).toBe(2.8);
    // exifr normalises the EXIF ISOSpeedRatings tag to `ISO`.
    expect(result.exif.ISO).toBe(400);
    expect(result.exif.FocalLength).toBe(50);
    expect(result.takenAt?.toISOString()).toBe("2024-03-14T09:26:53.000Z");
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/);

    const meta = await sharp(result.thumbnail).metadata();
    expect(meta.format).toBe("webp");
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(400);
  });

  it("produces a webp display rendition capped at DISPLAY_MAX", async () => {
    const big = path.join(dir, "big.jpg");
    await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#abcdef" } })
      .jpeg()
      .toFile(big);

    const result = await processImage(big);

    const meta = await sharp(result.display).metadata();
    expect(meta.format).toBe("webp");
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(2048);
    // The display is a higher-resolution rendition than the thumbnail.
    expect(result.display.length).toBeGreaterThan(result.thumbnail.length);
  });

  it("returns null takenAt when EXIF has no date", async () => {
    const noexif = path.join(dir, "noexif.png");
    await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } })
      .png()
      .toFile(noexif);

    const result = await processImage(noexif);
    expect(result.takenAt).toBeNull();
  });
});
