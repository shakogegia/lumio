import { readFile } from "node:fs/promises";
import { extractMetadata } from "./metadata.js";
import { hashBuffer } from "./hash.js";
import type { ExifData, WbBaseline } from "@lumio/shared";
import { decodeToSharpInput } from "./decode.js";
import { buildRenditions } from "./renditions.js";
import { estimateAsShotFromImage } from "./wb-estimate.js";

export interface ProcessedPhoto {
  width: number;
  height: number;
  takenAt: Date | null;
  hash: string;
  thumbhash: string;
  exif: ExifData;
  thumbnail: Buffer;
  display: Buffer;
  asShot: WbBaseline | null;
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
    const hash = hashBuffer(original);
    const asShot = await estimateAsShotFromImage(thumbnail);

    return { width, height, takenAt, hash, thumbhash, exif, thumbnail, display, asShot };
  } finally {
    await decoded.cleanup();
  }
}
