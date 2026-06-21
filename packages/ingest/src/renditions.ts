import sharp from "sharp";
import type { Sharp } from "sharp";
import {
  hasEdits,
  hasGeometry,
  hasColor,
  toneLinear,
  modulateParams,
  tempFadeLinear,
  vignetteStrength,
  cropToExtract,
  centeredAspectCrop,
  straightenedSize,
  type PhotoEdits,
} from "@lumio/shared";
import { DISPLAY_MAX, THUMBNAIL_MAX, EDITED_JPEG_QUALITY } from "./constants.js";
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

/** Apply straighten (free-angle rotate, opaque background (excluded by the
 *  clamped crop)) then crop. Takes
 *  a sharp pipeline that has ALREADY had flip + coarse-rotate applied, plus the
 *  oriented dims (wo,ho) of that pipeline. When straighten is set but no explicit
 *  crop, auto-inscribes the largest centered crop of the oriented aspect so the
 *  output never contains empty corners. Returns a fresh sharp instance; no-op
 *  (returns `img`) when neither straighten nor crop is set. */
export async function applyStraightenCrop(
  img: Sharp,
  edits: PhotoEdits | null,
  wo: number,
  ho: number,
): Promise<Sharp> {
  const deg = edits?.straighten ?? 0;
  let crop = edits?.crop ?? null;
  if (deg === 0 && !crop) return img;
  let pipe = img;
  if (deg !== 0) {
    pipe = pipe.rotate(deg, { background: { r: 0, g: 0, b: 0 } });
    if (!crop) crop = centeredAspectCrop(wo / ho, wo, ho, deg); // auto-fill, no empty corners
  }
  if (!crop) return pipe;
  // Materialize to read the true post-rotate canvas size, then extract by fraction.
  const buf = await pipe.png().toBuffer();
  const meta = await sharp(buf).metadata();
  const ex = cropToExtract(crop, meta.width ?? 0, meta.height ?? 0);
  return sharp(buf).extract(ex);
}

/** Apply the color recipe to an ALREADY-FRAMED pipeline (flip/rotate/straighten/
 *  crop done). Order matches the CSS preview: gain×contrast → saturation/hue →
 *  temperature×fade → vignette (last, on the final frame). Materializes between
 *  the two linear stages so their order is deterministic (sharp keeps a single
 *  linear slot). No-op (returns `img`) when the recipe has no color. */
async function applyColor(img: Sharp, edits: PhotoEdits | null): Promise<Sharp> {
  if (!hasColor(edits)) return img;
  const tone = toneLinear(edits);
  const mod = modulateParams(edits);
  const tempFade = tempFadeLinear(edits);
  const vig = vignetteStrength(edits);

  // Pass 1: tone (gain×contrast) then saturation/hue.
  let pass1 = img;
  if (tone) pass1 = pass1.linear(tone.a, tone.b);
  if (mod) pass1 = pass1.modulate({ saturation: mod.saturation, hue: mod.hue });
  let buf = await pass1.png().toBuffer();

  // Pass 2: temperature×fade as one per-channel linear.
  if (tempFade) {
    buf = await sharp(buf).linear(tempFade.a, tempFade.b).png().toBuffer();
  }

  // Pass 3: vignette — composite a radial darkening mask sized to the frame.
  if (vig > 0) {
    const meta = await sharp(buf).metadata();
    const svg = vignetteSvg(meta.width ?? 0, meta.height ?? 0, vig);
    buf = await sharp(buf)
      .composite([{ input: Buffer.from(svg), blend: "over" }])
      .flatten({ background: { r: 0, g: 0, b: 0 } })
      .png()
      .toBuffer();
  }

  return sharp(buf);
}

function vignetteSvg(w: number, h: number, alpha: number): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<defs><radialGradient id="v" cx="50%" cy="50%" r="75%">` +
    `<stop offset="45%" stop-color="#000" stop-opacity="0"/>` +
    `<stop offset="100%" stop-color="#000" stop-opacity="${alpha.toFixed(3)}"/>` +
    `</radialGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#v)"/></svg>`
  );
}

/**
 * Encode a full-resolution edited JPEG: bake EXIF orientation into a buffer, then
 * apply the recipe (so auto-orient and explicit rotate don't mix) and JPEG-encode.
 * Shared by the edited-download route and the edited bulk-zip.
 */
export async function encodeEditedJpeg(
  input: RenditionInput,
  edits: PhotoEdits | null,
): Promise<Buffer> {
  const oriented = await sharp(input).rotate().toBuffer();
  if (!hasEdits(edits)) {
    return applyEdits(sharp(oriented), edits).jpeg({ quality: EDITED_JPEG_QUALITY }).toBuffer();
  }
  const m = await sharp(oriented).metadata();
  const swap = edits?.rotate === 90 || edits?.rotate === 270;
  const wo = (swap ? m.height : m.width) ?? 0;
  const ho = (swap ? m.width : m.height) ?? 0;
  const framed = await applyStraightenCrop(applyEdits(sharp(oriented), edits), edits, wo, ho);
  const baked = await applyColor(framed, edits);
  return baked.jpeg({ quality: EDITED_JPEG_QUALITY }).toBuffer();
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
  const geom = hasGeometry(edits);

  let source: RenditionInput = input;
  if (geom) {
    source = await sharp(input).rotate().toBuffer(); // EXIF orientation baked in
  }

  // Oriented dims (post flip + coarse-rotate). `source` is the EXIF-baked buffer,
  // so its metadata gives EXIF-oriented dims; the coarse rotate swaps on 90/270.
  let wo = 0;
  let ho = 0;
  if (geom) {
    const sm = await sharp(source).metadata();
    const swap = edits!.rotate === 90 || edits!.rotate === 270;
    wo = (swap ? sm.height : sm.width) ?? 0;
    ho = (swap ? sm.width : sm.height) ?? 0;
  }

  const start = () => (geom ? sharp(source) : sharp(source).rotate());
  const framed = await applyStraightenCrop(applyEdits(start(), edits), edits, wo, ho);
  const baked = await applyColor(framed, edits);
  const display = await baked
    .resize(DISPLAY_MAX, DISPLAY_MAX, FIT)
    .webp({ quality: 80 })
    .toBuffer();
  const thumbnail = await sharp(display)
    .resize(THUMBNAIL_MAX, THUMBNAIL_MAX, FIT)
    .webp({ quality: 80 })
    .toBuffer();
  const thumbhash = await computeThumbhash(thumbnail);

  // Dimensions: derive analytically from the geometry (matches the bake's
  // straighten + auto-fill/crop), avoiding a second bake. A ±1px rounding vs the
  // actual rendition is harmless (used for layout/optimistic patch only).
  let width: number;
  let height: number;
  if (geom) {
    const deg = edits!.straighten ?? 0;
    const op = straightenedSize(wo, ho, deg);
    const crop = edits!.crop ?? (deg !== 0 ? centeredAspectCrop(wo / ho, wo, ho, deg) : null);
    width = crop ? Math.max(1, Math.round(crop.w * op.w)) : Math.round(op.w);
    height = crop ? Math.max(1, Math.round(crop.h * op.h)) : Math.round(op.h);
  } else {
    const meta = await sharp(source).metadata();
    const swap = (meta.orientation ?? 1) >= 5;
    width = (swap ? meta.height : meta.width) ?? 0;
    height = (swap ? meta.width : meta.height) ?? 0;
  }

  return { display, thumbnail, thumbhash, width, height };
}

