import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extractMetadata } from "./metadata.js";
import type { ExifData } from "@lumio/shared";
import { decodeToSharpInput } from "./decode.js";
import { buildRenditions } from "./renditions.js";

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
  const decoded = await decodeToSharpInput(absPath);
  try {
    const { exif, takenAt } = await extractMetadata(original);

    const { display, thumbnail, thumbhash, width, height } = await buildRenditions(
      decoded.input,
      null,
    );
    const hash = createHash("sha256").update(original).digest("hex");

    return { width, height, takenAt, hash, thumbhash, exif, thumbnail, display };
  } finally {
    await decoded.cleanup();
  }
}
