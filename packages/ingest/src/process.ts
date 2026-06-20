import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extractMetadata } from "./metadata.js";
import sharp from "sharp";
import type { ExifData } from "@lumio/shared";
import { DISPLAY_MAX, THUMBNAIL_MAX } from "./constants.js";
import { decodeToSharpInput } from "./decode.js";
import { computeThumbhash } from "./thumbhash.js";

export interface ProcessedPhoto {
  width: number;
  height: number;
  takenAt: Date | null;
  hash: string;
  thumbhash: string;
  exif: ExifData;
  thumbnail: Buffer;
  display: Buffer;
}

const FIT = { fit: "inside", withoutEnlargement: true } as const;

/** Read an image and derive everything the store layer needs. No DB or FS writes. */
export async function processImage(absPath: string): Promise<ProcessedPhoto> {
  const original = await readFile(absPath); // for hash + EXIF (original format)
  const decoded = await decodeToSharpInput(absPath);
  try {
    const { exif, takenAt } = await extractMetadata(original);

    // Stored dimensions are the *oriented* (as-displayed) size. EXIF orientations
    // 5-8 rotate by 90/270° and therefore swap width and height.
    const meta = await sharp(decoded.input).metadata();
    const swap = (meta.orientation ?? 1) >= 5;
    const width = (swap ? meta.height : meta.width) ?? 0;
    const height = (swap ? meta.width : meta.height) ?? 0;

    // Decode once for the display, auto-orienting via EXIF; then derive the
    // thumbnail from that display buffer — one full decode instead of two, at the
    // cost of a visually negligible second WebP recompression at <=400px.
    const display = await sharp(decoded.input)
      .rotate()
      .resize(DISPLAY_MAX, DISPLAY_MAX, FIT)
      .webp({ quality: 80 })
      .toBuffer();
    const thumbnail = await sharp(display)
      .resize(THUMBNAIL_MAX, THUMBNAIL_MAX, FIT)
      .webp({ quality: 80 })
      .toBuffer();

    const thumbhash = await computeThumbhash(thumbnail);
    const hash = createHash("sha256").update(original).digest("hex");

    return { width, height, takenAt, hash, thumbhash, exif, thumbnail, display };
  } finally {
    await decoded.cleanup();
  }
}
