import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { regenerateRenditions } from "./regenerate.js";

const dir = await mkdtemp(path.join(tmpdir(), "lumio-regen-"));
afterAll(async () => rm(dir, { recursive: true, force: true }));

// A 4x2 landscape PNG, no EXIF orientation.
const src = path.join(dir, "src.png");
await sharp({ create: { width: 4, height: 2, channels: 3, background: { r: 1, g: 2, b: 3 } } })
  .png()
  .toFile(src);

describe("regenerateRenditions", () => {
  it("writes display + thumbnail named by id and returns a thumbhash", async () => {
    const thumbs = path.join(dir, "t1");
    const displays = path.join(dir, "d1");
    const out = await regenerateRenditions(src, null, "pA", { thumbnailsDir: thumbs, displaysDir: displays });

    expect([out.width, out.height]).toEqual([4, 2]);
    expect(typeof out.thumbhash).toBe("string");
    const display = await readFile(path.join(displays, "pA.webp"));
    const meta = await sharp(display).metadata();
    expect([meta.width, meta.height]).toEqual([4, 2]);
  });

  it("bakes the edit recipe — a 90° rotation swaps the rendition's dimensions", async () => {
    const thumbs = path.join(dir, "t2");
    const displays = path.join(dir, "d2");
    const out = await regenerateRenditions(
      src,
      { rotate: 90, flipH: false, flipV: false },
      "pB",
      { thumbnailsDir: thumbs, displaysDir: displays },
    );

    expect([out.width, out.height]).toEqual([2, 4]);
    const display = await readFile(path.join(displays, "pB.webp"));
    const meta = await sharp(display).metadata();
    expect([meta.width, meta.height]).toEqual([2, 4]);

    const thumb = await readFile(path.join(thumbs, "pB.webp"));
    const tmeta = await sharp(thumb).metadata();
    expect([tmeta.width, tmeta.height]).toEqual([2, 4]);
  });
});
