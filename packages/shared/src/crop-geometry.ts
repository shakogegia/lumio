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

/** True when all four corners of `crop` land on real pixels. */
export function cropOnImage(crop: CropRect, wo: number, ho: number, deg: number): boolean {
  return (
    pointOnImage(crop.x, crop.y, wo, ho, deg) &&
    pointOnImage(crop.x + crop.w, crop.y, wo, ho, deg) &&
    pointOnImage(crop.x, crop.y + crop.h, wo, ho, deg) &&
    pointOnImage(crop.x + crop.w, crop.y + crop.h, wo, ho, deg)
  );
}

function lerpCrop(a: CropRect, b: CropRect, t: number): CropRect {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    w: a.w + (b.w - a.w) * t,
    h: a.h + (b.h - a.h) * t,
  };
}

/** The furthest point along the segment from a valid `from` toward `to` whose
 *  crop is still fully on real pixels. Used to advance an interactive drag up to
 *  the image edge (pinning) instead of shrinking it about its center. Assumes
 *  `from` is on-image; returns `to` when `to` is already valid. */
export function maxValidAdvance(
  from: CropRect,
  to: CropRect,
  wo: number,
  ho: number,
  deg: number,
): CropRect {
  if (cropOnImage(to, wo, ho, deg)) return to;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (cropOnImage(lerpCrop(from, to, mid), wo, ho, deg)) lo = mid;
    else hi = mid;
  }
  return lerpCrop(from, to, lo);
}

/** Constrain an interactive crop gesture to the image, anchored at the gesture's
 *  fixed side so it pins at the edge rather than shrinking about its center.
 *  `start` is the (valid) crop at gesture start, `next` the unconstrained
 *  proposal (post aspect-lock). Move and ratio-locked resizes advance the whole
 *  rect along the gesture; a free corner resize advances each edge independently
 *  so it slides along the image edges. Falls back to the center-shrink clamp only
 *  when `start` is itself off-image (e.g. a full crop while straightened). */
export function constrainCropDrag(
  start: CropRect,
  next: CropRect,
  wo: number,
  ho: number,
  deg: number,
  opts: { move?: boolean; aspectLocked?: boolean } = {},
): CropRect {
  if (!cropOnImage(start, wo, ho, deg)) return clampCropToImage(next, wo, ho, deg);
  if (opts.move || opts.aspectLocked) return maxValidAdvance(start, next, wo, ho, deg);
  const movedH = next.x !== start.x || next.w !== start.w;
  const movedV = next.y !== start.y || next.h !== start.h;
  if (movedH && movedV) {
    const horiz = maxValidAdvance(
      start,
      { x: next.x, y: start.y, w: next.w, h: start.h },
      wo,
      ho,
      deg,
    );
    return maxValidAdvance(
      horiz,
      { x: horiz.x, y: next.y, w: horiz.w, h: next.h },
      wo,
      ho,
      deg,
    );
  }
  return maxValidAdvance(start, next, wo, ho, deg);
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
