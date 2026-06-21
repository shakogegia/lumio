import type { CropRect } from "./types.js";

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Bounding-box (O′) size of an Wo×Ho rectangle rotated by `deg`. */
export function straightenedSize(wo: number, ho: number, deg: number): { w: number; h: number } {
  const c = Math.abs(Math.cos(rad(deg)));
  const s = Math.abs(Math.sin(rad(deg)));
  return { w: wo * c + ho * s, h: wo * s + ho * c };
}

/** True when a normalized O′ point (px,py)∈[0,1]² lands on real pixels — i.e.
 *  inside the rotated Wo×Ho rectangle centered in O′ — not an empty corner. */
export function pointOnImage(px: number, py: number, wo: number, ho: number, deg: number): boolean {
  const { w, h } = straightenedSize(wo, ho, deg);
  const a = rad(-deg);
  const dx = px * w - w / 2;
  const dy = py * h - h / 2;
  const x = dx * Math.cos(a) - dy * Math.sin(a);
  const y = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(x) <= wo / 2 + 1e-6 && Math.abs(y) <= ho / 2 + 1e-6;
}

/** Shrink `crop` about its own center (preserving aspect) until all four corners
 *  lie on real pixels. Returns the input unchanged when already valid. */
export function clampCropToImage(crop: CropRect, wo: number, ho: number, deg: number): CropRect {
  const cx = crop.x + crop.w / 2;
  const cy = crop.y + crop.h / 2;
  const ok = (s: number): boolean => {
    const hw = (crop.w * s) / 2;
    const hh = (crop.h * s) / 2;
    return (
      pointOnImage(cx - hw, cy - hh, wo, ho, deg) &&
      pointOnImage(cx + hw, cy - hh, wo, ho, deg) &&
      pointOnImage(cx - hw, cy + hh, wo, ho, deg) &&
      pointOnImage(cx + hw, cy + hh, wo, ho, deg)
    );
  };
  if (ok(1)) return crop;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return { x: cx - (crop.w * lo) / 2, y: cy - (crop.h * lo) / 2, w: crop.w * lo, h: crop.h * lo };
}

/** A centered, max-fit crop of aspect `ratio` (w/h) within the oriented image,
 *  normalized to O′ and clamped to real pixels. */
export function centeredAspectCrop(ratio: number, wo: number, ho: number, deg: number): CropRect {
  const { w, h } = straightenedSize(wo, ho, deg);
  let cw = wo;
  let ch = wo / ratio;
  if (ch > ho) {
    ch = ho;
    cw = ho * ratio;
  }
  const rect: CropRect = {
    x: (w - cw) / 2 / w,
    y: (h - ch) / 2 / h,
    w: cw / w,
    h: ch / h,
  };
  return clampCropToImage(rect, wo, ho, deg);
}

/** Pixel extract rect (for sharp) given a crop normalized to a W×H canvas.
 *  Clamps defensively so it can never request pixels outside the canvas. */
export function cropToExtract(
  crop: CropRect,
  canvasW: number,
  canvasH: number,
): { left: number; top: number; width: number; height: number } {
  const left = Math.min(Math.max(0, Math.round(crop.x * canvasW)), canvasW - 1);
  const top = Math.min(Math.max(0, Math.round(crop.y * canvasH)), canvasH - 1);
  const width = Math.max(1, Math.min(Math.round(crop.w * canvasW), canvasW - left));
  const height = Math.max(1, Math.min(Math.round(crop.h * canvasH), canvasH - top));
  return { left, top, width, height };
}
