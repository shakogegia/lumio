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

    let width: number;
    let height: number;
    let display: Buffer;
    let thumbnail: Buffer;

    if (decoded.raw) {
      // JXL: pixels are already decoded in memory, so re-wrapping the buffer
      // costs no decode — derive BOTH renditions from full-quality raw.
      const { width: w, height: h, channels } = decoded.raw;
      const buf = decoded.input as Buffer;
      const src = () => sharp(buf, { raw: { width: w, height: h, channels } });
      width = w;
      height = h;
      display = await src().resize(DISPLAY_MAX, DISPLAY_MAX, FIT).webp({ quality: 80 }).toBuffer();
      thumbnail = await src().resize(THUMBNAIL_MAX, THUMBNAIL_MAX, FIT).webp({ quality: 80 }).toBuffer();
    } else {
      // native / HEIC temp PNG: decode once for the display, then derive the thumbnail
      // from that display buffer — skips a second full decode at the cost of one extra
      // (visually negligible at <=400px) WebP recompression.
      const meta = await sharp(decoded.input).metadata();
      width = meta.width ?? 0;
      height = meta.height ?? 0;
      const pipe = sharp(decoded.input);
      if (decoded.rotate) pipe.rotate(); // applies EXIF orientation in place
      display = await pipe.resize(DISPLAY_MAX, DISPLAY_MAX, FIT).webp({ quality: 80 }).toBuffer();
      thumbnail = await sharp(display).resize(THUMBNAIL_MAX, THUMBNAIL_MAX, FIT).webp({ quality: 80 }).toBuffer();
    }

    const thumbhash = await computeThumbhash(thumbnail);
    const hash = createHash("sha256").update(original).digest("hex");

    return { width, height, takenAt, hash, thumbhash, exif, thumbnail, display };
  } finally {
    await decoded.cleanup();
  }
}
