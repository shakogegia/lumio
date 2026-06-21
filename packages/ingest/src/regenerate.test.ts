import { access, mkdtemp, readFile, rm } from "node:fs/promises";
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
  it("null edits: writes edit-free base display + thumbnail, no edited file", async () => {
    const thumbs = path.join(dir, "t1");
    const displays = path.join(dir, "d1");
    const editedDisplays = path.join(dir, "e1");
    const out = await regenerateRenditions(src, null, "pA", {
      thumbnailsDir: thumbs,
      displaysDir: displays,
      editedDisplaysDir: editedDisplays,
    });

    expect([out.width, out.height]).toEqual([4, 2]);
    expect(typeof out.thumbhash).toBe("string");

    // Base display written at original size.
    const display = await readFile(path.join(displays, "pA.webp"));
    const meta = await sharp(display).metadata();
    expect([meta.width, meta.height]).toEqual([4, 2]);

    // No edited variant written (file should not exist).
    await expect(access(path.join(editedDisplays, "pA.webp"))).rejects.toThrow();
  });

  it("with edits: base display stays edit-free, edited display + thumbnail are baked", async () => {
    const thumbs = path.join(dir, "t2");
    const displays = path.join(dir, "d2");
    const editedDisplays = path.join(dir, "e2");
    const out = await regenerateRenditions(
      src,
      { rotate: 90, flipH: false, flipV: false },
      "pB",
      { thumbnailsDir: thumbs, displaysDir: displays, editedDisplaysDir: editedDisplays },
    );

    // Returned dims reflect the edited (rotated) image.
    expect([out.width, out.height]).toEqual([2, 4]);

    // Base display is still the original orientation (4×2).
    const baseDisplay = await readFile(path.join(displays, "pB.webp"));
    const baseMeta = await sharp(baseDisplay).metadata();
    expect([baseMeta.width, baseMeta.height]).toEqual([4, 2]);

    // Edited display has the rotated size (2×4).
    const editedDisplay = await readFile(path.join(editedDisplays, "pB.webp"));
    const editedMeta = await sharp(editedDisplay).metadata();
    expect([editedMeta.width, editedMeta.height]).toEqual([2, 4]);

    // Base display and edited display should differ (different content).
    expect(baseDisplay.equals(editedDisplay)).toBe(false);

    // Thumbnail also reflects the edited image (2×4).
    const thumb = await readFile(path.join(thumbs, "pB.webp"));
    const tmeta = await sharp(thumb).metadata();
    expect([tmeta.width, tmeta.height]).toEqual([2, 4]);
  });

  it("null edits removes a stale edited file if present", async () => {
    const thumbs = path.join(dir, "t3");
    const displays = path.join(dir, "d3");
    const editedDisplays = path.join(dir, "e3");

    // First call with edits to create the edited file.
    await regenerateRenditions(
      src,
      { rotate: 90, flipH: false, flipV: false },
      "pC",
      { thumbnailsDir: thumbs, displaysDir: displays, editedDisplaysDir: editedDisplays },
    );
    await expect(access(path.join(editedDisplays, "pC.webp"))).resolves.toBeUndefined();

    // Second call with null edits: edited file should be removed.
    await regenerateRenditions(src, null, "pC", {
      thumbnailsDir: thumbs,
      displaysDir: displays,
      editedDisplaysDir: editedDisplays,
    });
    await expect(access(path.join(editedDisplays, "pC.webp"))).rejects.toThrow();
  });
});
