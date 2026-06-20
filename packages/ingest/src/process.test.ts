import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { processImage } from "./process.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
async function hasBin(bin: string): Promise<boolean> {
  try { await execFileAsync("which", [bin]); return true; } catch { return false; }
}
const JXL_TOOLS = (await hasBin("cjxl")) && (await hasBin("djxl"));

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
    expect(typeof result.thumbhash).toBe("string");
    expect(result.thumbhash.length).toBeGreaterThan(0);

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

describe.skipIf(!JXL_TOOLS)("processImage — JXL", () => {
  it("decodes a .jxl into thumbnail + display + thumbhash with correct dims", async () => {
    const src = path.join(dir, "jxl-src.png");
    const jxl = path.join(dir, "photo.jxl");
    await sharp({ create: { width: 300, height: 200, channels: 3, background: "#779988" } })
      .png()
      .toFile(src);
    await execFileAsync("cjxl", [src, jxl, "-q", "90"]);

    const result = await processImage(jxl);

    expect(result.width).toBe(300);
    expect(result.height).toBe(200);
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.thumbhash.length).toBeGreaterThan(0);

    const thumbMeta = await sharp(result.thumbnail).metadata();
    expect(thumbMeta.format).toBe("webp");
    expect(Math.max(thumbMeta.width ?? 0, thumbMeta.height ?? 0)).toBeLessThanOrEqual(400);

    const dispMeta = await sharp(result.display).metadata();
    expect(dispMeta.format).toBe("webp");
  });

  it("applies EXIF orientation (djxl bakes it) — a rotated source decodes upright", async () => {
    // Source is 400x200 tagged orientation=6 (90° CW) → should present as 200x400.
    const src = path.join(dir, "oriented-src.jpg");
    const jxl = path.join(dir, "oriented.jxl");
    await sharp({ create: { width: 400, height: 200, channels: 3, background: "#445566" } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toFile(src);
    await execFileAsync("cjxl", [src, jxl, "--lossless_jpeg=1"]);

    const result = await processImage(jxl);
    expect(result.width).toBe(200);
    expect(result.height).toBe(400);
  });
});
