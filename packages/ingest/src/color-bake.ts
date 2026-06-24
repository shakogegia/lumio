import sharp from "sharp";
import type { Sharp } from "sharp";
import { applyColorToRaw, buildColorModel, hasColor, type PhotoEdits } from "@lumio/shared";

/**
 * Apply the recipe's color in a SINGLE float-precision raw pass.
 *
 * The legacy bake chained several `sharp` ops (tone `.linear()` → `.modulate()` →
 * per-channel `.linear()` → vignette composite), each round-tripping through an
 * 8-bit PNG buffer — so every step re-quantized to 256 levels and the errors
 * compounded into visible banding on smooth gradients. Here we instead read the
 * pixels once, run the SHARED per-pixel kernel in floating point (exposure /
 * brightness / contrast / highlights / shadows / whites / blacks / fade + curves
 * via a tone LUT, then temperature / hue / saturation / vibrance, then vignette),
 * and quantize exactly once on write-back. This is the same math the WebGL preview
 * runs (`applyColorToRaw`), so the bake matches what the user saw while editing.
 *
 * Note on bit depth: the output renditions are 8-bit (JPEG/WebP), so a 16-bit
 * working *container* would add no quality for 8-bit sources — the banding win is
 * the single float pass, not the container width. (sharp 0.33's raw I/O doesn't
 * round-trip 16-bit cleanly anyway.) The kernel itself is depth-agnostic (it takes
 * a maxVal), so a future 16-bit-output path can reuse it unchanged.
 *
 * Operates on the RGB channels only; an alpha channel (if present) is preserved.
 * No-op (returns `img`) when the recipe has no color component.
 */
export async function applyColorBake(img: Sharp, edits: PhotoEdits | null): Promise<Sharp> {
  if (!hasColor(edits)) return img;
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const model = buildColorModel(edits);
  applyColorToRaw(data, info.width, info.height, info.channels, 255, model);
  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  });
}
