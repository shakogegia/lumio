import sharp from "sharp";
import type { Sharp } from "sharp";
import type { PhotoEdits } from "@lumio/shared";
import { DISPLAY_MAX, THUMBNAIL_MAX } from "./constants.js";
import { computeThumbhash } from "./thumbhash.js";

const FIT = { fit: "inside", withoutEnlargement: true } as const;

export type RenditionInput = Buffer | string;

export interface Renditions {
  display: Buffer;
  thumbnail: Buffer;
  thumbhash: string;
  width: number;
  height: number;
}

/** Apply the user recipe to an already EXIF-oriented pipeline: flipH (flop),
 *  flipV (flip), then rotate clockwise. No-op when edits is null. */
export function applyEdits(img: Sharp, edits: PhotoEdits | null): Sharp {
  if (!edits) return img;
  let out = img;
  if (edits.flipH) out = out.flop();
  if (edits.flipV) out = out.flip();
  if (edits.rotate) out = out.rotate(edits.rotate);
  return out;
}

/**
 * Build the display + thumbnail WebP renditions (and thumbhash + oriented size)
 * for an image, optionally with a user edit recipe. The no-edit path matches the
 * original ingest pipeline (single decode → auto-orient → resize). With geometry
 * edits, the EXIF orientation is first baked into a buffer so the explicit
 * flip/rotate compose unambiguously (auto-orient + explicit rotate must not mix).
 */
export async function buildRenditions(
  input: RenditionInput,
  edits: PhotoEdits | null,
): Promise<Renditions> {
  const geom = !!edits && (edits.rotate !== 0 || edits.flipH || edits.flipV);

  let source: RenditionInput = input;
  let exifBaked = false;
  if (geom) {
    source = await sharp(input).rotate().toBuffer(); // EXIF orientation now baked in
    exifBaked = true;
  }

  const start = () => (exifBaked ? sharp(source) : sharp(source).rotate());
  const display = await applyEdits(start(), edits)
    .resize(DISPLAY_MAX, DISPLAY_MAX, FIT)
    .webp({ quality: 80 })
    .toBuffer();
  const thumbnail = await sharp(display)
    .resize(THUMBNAIL_MAX, THUMBNAIL_MAX, FIT)
    .webp({ quality: 80 })
    .toBuffer();
  const thumbhash = await computeThumbhash(thumbnail);

  const meta = await sharp(source).metadata();
  let width: number;
  let height: number;
  if (exifBaked) {
    width = meta.width ?? 0;
    height = meta.height ?? 0;
  } else {
    const swap = (meta.orientation ?? 1) >= 5; // EXIF 5-8 rotate 90/270
    width = (swap ? meta.height : meta.width) ?? 0;
    height = (swap ? meta.width : meta.height) ?? 0;
  }
  if (geom && (edits!.rotate === 90 || edits!.rotate === 270)) {
    [width, height] = [height, width];
  }

  return { display, thumbnail, thumbhash, width, height };
}
