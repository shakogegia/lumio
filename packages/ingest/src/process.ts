import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extractMetadata } from "./metadata.js";
import sharp from "sharp";
import type { ExifData } from "@lumio/shared";
import { DISPLAY_MAX, THUMBNAIL_MAX } from "./constants.js";
import { decodeToReadable } from "./decode.js";
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

/** Read an image and derive everything the store layer needs. No DB or FS writes. */
export async function processImage(absPath: string): Promise<ProcessedPhoto> {
  const original = await readFile(absPath); // for hash + EXIF (original format)
  const decoded = await decodeToReadable(absPath);
  try {
    const meta = await sharp(decoded.path).metadata();

    const { exif, takenAt } = await extractMetadata(original);

    const thumbnail = await sharp(decoded.path)
      .rotate()
      .resize(THUMBNAIL_MAX, THUMBNAIL_MAX, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    const thumbhash = await computeThumbhash(thumbnail);

    // Browser-renderable rendition for the detail view: non-native formats
    // (JXL/HEIC) decode to webp here, and large originals stay a sane size.
    const display = await sharp(decoded.path)
      .rotate()
      .resize(DISPLAY_MAX, DISPLAY_MAX, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    const hash = createHash("sha256").update(original).digest("hex");

    return { width: meta.width ?? 0, height: meta.height ?? 0, takenAt, hash, thumbhash, exif, thumbnail, display };
  } finally {
    await decoded.cleanup();
  }
}
