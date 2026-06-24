import sharp from "sharp";
import { estimateAsShotWhite, type WbBaseline } from "@lumio/shared";

/**
 * Estimate a photo's as-shot white balance from an image (Buffer or path). Decodes
 * a ≤128px raw RGB thumbnail of an ALREADY-small input (the ingest thumbnail), so
 * this adds a single tiny decode — no full-resolution re-decode. Returns null when
 * the image has no usable near-neutral pixels.
 */
export async function estimateAsShotFromImage(image: string | Buffer): Promise<WbBaseline | null> {
  try {
    const { data, info } = await sharp(image)
      .resize(128, 128, { fit: "inside", withoutEnlargement: true })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const wb = estimateAsShotWhite(new Uint8Array(data), info.width, info.height, info.channels);
    // Round to clean slider stops (K → nearest 10, the slider step; tint → integer):
    // the baseline is a display anchor, so a fractional Kelvin only shows as noise.
    return wb && { k: Math.round(wb.k / 10) * 10, tint: Math.round(wb.tint) };
  } catch {
    return null; // a bad/odd image must never block ingest
  }
}
