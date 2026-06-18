import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import exifr from "exifr";
import sharp from "sharp";
import type { ExifData } from "@lumio/shared";
import { DISPLAY_MAX, THUMBNAIL_MAX } from "./constants.js";
import { decodeToReadable } from "./decode.js";

export interface ProcessedPhoto {
  width: number;
  height: number;
  takenAt: Date | null;
  hash: string;
  exif: ExifData;
  thumbnail: Buffer;
  display: Buffer;
}

function parseExifDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  return null;
}

/** Read an image and derive everything the store layer needs. No DB or FS writes. */
export async function processImage(absPath: string): Promise<ProcessedPhoto> {
  const original = await readFile(absPath); // for hash + EXIF (original format)
  const decoded = await decodeToReadable(absPath);
  try {
    const meta = await sharp(decoded.path).metadata();

    const raw = (await exifr.parse(original).catch(() => null)) ?? {};
    const takenAt = parseExifDate(raw.DateTimeOriginal ?? raw.CreateDate);
    const exif: ExifData = {
      takenAt: takenAt ? takenAt.toISOString() : undefined,
      cameraMake: typeof raw.Make === "string" ? raw.Make.trim() : undefined,
      cameraModel: typeof raw.Model === "string" ? raw.Model.trim() : undefined,
      orientation: typeof raw.Orientation === "number" ? raw.Orientation : undefined,
    };

    const thumbnail = await sharp(decoded.path)
      .rotate()
      .resize(THUMBNAIL_MAX, THUMBNAIL_MAX, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    // Browser-renderable rendition for the detail view: non-native formats
    // (JXL/HEIC) decode to webp here, and large originals stay a sane size.
    const display = await sharp(decoded.path)
      .rotate()
      .resize(DISPLAY_MAX, DISPLAY_MAX, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    const hash = createHash("sha256").update(original).digest("hex");

    return { width: meta.width ?? 0, height: meta.height ?? 0, takenAt, hash, exif, thumbnail, display };
  } finally {
    await decoded.cleanup();
  }
}
