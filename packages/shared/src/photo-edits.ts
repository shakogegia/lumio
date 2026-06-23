import type { CropRect, PhotoEdits } from "./types.js";
import { centeredAspectCrop, straightenedSize } from "./crop-geometry.js";
import { COLOR_FIELDS, hasColor } from "./photo-color.js";

/** Current edit-recipe schema version. Stamped on every coerced/saved recipe so a
 *  future shape change can branch on it at the read boundary. Zero migration:
 *  legacy rows lack the field and are read as v1. */
export const EDITS_VERSION = 1;

export const NO_EDITS: PhotoEdits = {
  version: EDITS_VERSION,
  rotate: 0,
  flipH: false,
  flipV: false,
  straighten: 0,
  crop: null,
};

/** True when the recipe applies any geometry change (flip/rotate/straighten/crop). */
export function hasGeometry(e: PhotoEdits | null): boolean {
  return (
    e !== null &&
    (e.rotate !== 0 || e.flipH || e.flipV || (e.straighten ?? 0) !== 0 || e.crop != null)
  );
}

export { hasColor } from "./photo-color.js";

/** True when the recipe changes the image at all (geometry or color). */
export function hasEdits(e: PhotoEdits | null): boolean {
  return hasGeometry(e) || hasColor(e);
}

function sameCrop(a: CropRect | null | undefined, b: CropRect | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/** Structural equality of two recipes. */
export function sameEdits(a: PhotoEdits, b: PhotoEdits): boolean {
  return (
    a.rotate === b.rotate &&
    a.flipH === b.flipH &&
    a.flipV === b.flipV &&
    (a.straighten ?? 0) === (b.straighten ?? 0) &&
    sameCrop(a.crop, b.crop) &&
    COLOR_FIELDS.every((f) => (a[f.key] ?? 0) === (b[f.key] ?? 0))
  );
}

function withRotate(e: PhotoEdits, rotate: number): PhotoEdits {
  return { ...e, rotate: (((rotate % 360) + 360) % 360) as PhotoEdits["rotate"] };
}

// Crop is normalized to the on-screen (O′) frame, so coarse rotate/flip map it
// with simple normalized-rect transforms. 90° also swaps width/height.
function rotateCropCW(c: CropRect): CropRect {
  return { x: 1 - (c.y + c.h), y: c.x, w: c.h, h: c.w };
}
function rotateCropCCW(c: CropRect): CropRect {
  return { x: c.y, y: 1 - (c.x + c.w), w: c.h, h: c.w };
}
function mirrorCropX(c: CropRect): CropRect {
  return { x: 1 - (c.x + c.w), y: c.y, w: c.w, h: c.h };
}
function mirrorCropY(c: CropRect): CropRect {
  return { x: c.x, y: 1 - (c.y + c.h), w: c.w, h: c.h };
}

export function rotateRight(e: PhotoEdits): PhotoEdits {
  return { ...withRotate(e, e.rotate + 90), crop: e.crop ? rotateCropCW(e.crop) : null };
}

export function rotateLeft(e: PhotoEdits): PhotoEdits {
  return { ...withRotate(e, e.rotate - 90), crop: e.crop ? rotateCropCCW(e.crop) : null };
}

/** When rotated 90/270 the on-screen axes are swapped, so a "flip horizontal"
 *  button must toggle the stored vertical flip (and vice-versa) to stay visually
 *  intuitive. The stored recipe remains canonical. */
function axisSwapped(e: PhotoEdits): boolean {
  return e.rotate === 90 || e.rotate === 270;
}

export function toggleFlipH(e: PhotoEdits): PhotoEdits {
  const flipped = axisSwapped(e) ? { ...e, flipV: !e.flipV } : { ...e, flipH: !e.flipH };
  return {
    ...flipped,
    crop: e.crop ? mirrorCropX(e.crop) : null,
    straighten: -(e.straighten ?? 0),
  };
}

export function toggleFlipV(e: PhotoEdits): PhotoEdits {
  const flipped = axisSwapped(e) ? { ...e, flipH: !e.flipH } : { ...e, flipV: !e.flipV };
  return {
    ...flipped,
    crop: e.crop ? mirrorCropY(e.crop) : null,
    straighten: -(e.straighten ?? 0),
  };
}

export function setStraighten(e: PhotoEdits, deg: number): PhotoEdits {
  return { ...e, straighten: Math.max(-45, Math.min(45, deg)) };
}

export function setCrop(e: PhotoEdits, crop: CropRect | null): PhotoEdits {
  return { ...e, crop };
}

/** Aspect-ratio preset names used by the Crop chips. */
export type AspectPreset =
  | "free"
  | "original"
  | "square"
  | "5:4" | "4:5" | "4:3" | "3:4" | "3:2" | "2:3" | "16:9" | "9:16";

const RATIO: Record<Exclude<AspectPreset, "free" | "original">, number> = {
  square: 1,
  "5:4": 5 / 4, "4:5": 4 / 5, "4:3": 4 / 3, "3:4": 3 / 4,
  "3:2": 3 / 2, "2:3": 2 / 3, "16:9": 16 / 9, "9:16": 9 / 16,
};

/** Apply an aspect preset: returns the recipe with a centered max-fit crop at the
 *  requested ratio (computed against the oriented dims wo×ho). "free" clears any
 *  crop (unconstrained); "original" uses wo:ho. */
export function aspectCrop(e: PhotoEdits, preset: AspectPreset, wo: number, ho: number): PhotoEdits {
  if (preset === "free") return { ...e, crop: null };
  const deg = e.straighten ?? 0;
  const ratio = preset === "original" ? wo / ho : RATIO[preset];
  return { ...e, crop: centeredAspectCrop(ratio, wo, ho, deg) };
}

/** Predicted [width, height] after the recipe, for optimistic store patching.
 *  Mirrors the bake: straighten with no explicit crop auto-fills an inscribed crop. */
export function orientedSize(w: number, h: number, e: PhotoEdits | null): [number, number] {
  if (!e) return [w, h];
  const [ow, oh] = e.rotate === 90 || e.rotate === 270 ? [h, w] : [w, h];
  const deg = e.straighten ?? 0;
  const op = straightenedSize(ow, oh, deg);
  const crop = e.crop ?? (deg !== 0 ? centeredAspectCrop(ow / oh, ow, oh, deg) : null);
  const W = crop ? Math.round(crop.w * op.w) : Math.round(op.w);
  const H = crop ? Math.round(crop.h * op.h) : Math.round(op.h);
  return [Math.max(1, W), Math.max(1, H)];
}

function coerceCrop(value: unknown): CropRect | null {
  if (!value || typeof value !== "object") return null;
  const c = value as Record<string, unknown>;
  const nums = [c.x, c.y, c.w, c.h];
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1)) return null;
  if ((c.w as number) <= 0 || (c.h as number) <= 0) return null;
  if ((c.x as number) + (c.w as number) > 1 + 1e-6 || (c.y as number) + (c.h as number) > 1 + 1e-6) return null;
  return { x: c.x as number, y: c.y as number, w: c.w as number, h: c.h as number };
}

/** Defensively coerce an unknown JSON value (e.g. from the DB) into a recipe or
 *  null. Shared by the DTO mapper and the edited-download encoder. */
export function coercePhotoEdits(value: unknown): PhotoEdits | null {
  if (!value || typeof value !== "object") return null;
  const e = value as Record<string, unknown>;
  if (![0, 90, 180, 270].includes(e.rotate as number)) return null;
  if (typeof e.flipH !== "boolean" || typeof e.flipV !== "boolean") return null;
  const straighten =
    typeof e.straighten === "number" && Number.isFinite(e.straighten) && Math.abs(e.straighten) <= 45
      ? e.straighten
      : 0;
  const crop = coerceCrop(e.crop);
  const out: PhotoEdits = {
    version: EDITS_VERSION,
    rotate: e.rotate as PhotoEdits["rotate"],
    flipH: e.flipH,
    flipV: e.flipV,
    straighten,
    crop,
  };
  for (const f of COLOR_FIELDS) {
    const v = e[f.key];
    if (typeof v === "number" && Number.isFinite(v)) {
      const clamped = Math.max(f.min, Math.min(f.max, v));
      if (clamped !== f.neutral) out[f.key] = clamped;
    }
  }
  return out;
}

/**
 * The CSS transform to PREVIEW `working` when the on-screen image already shows
 * `saved` (the lightbox renders the baked, already-edited rendition). We must
 * apply only the DELTA `working ∘ saved⁻¹`, or an already-edited photo would be
 * transformed twice. Returns the delta as a clockwise rotation (deg) plus an
 * optional horizontal mirror — together these cover all 8 orientations.
 *
 * The dihedral group D4 is represented as `{ a, f }` = `Rot(a·90°) ∘ MirrorX^f`,
 * which composes as `(a₁ + (f₁ ? −a₂ : a₂), f₁ ⊕ f₂)` and whose CSS form is
 * `rotate(a·90deg)` followed by `scaleX(-1)` when `f` (scaleX applies first).
 */
interface D4 {
  a: 0 | 1 | 2 | 3;
  f: 0 | 1;
}

function recipeToD4(e: PhotoEdits): D4 {
  // Canonical order: flipH (MirrorX) → flipV (= Rot180 ∘ MirrorX) → rotate.
  const h: D4 = { a: 0, f: e.flipH ? 1 : 0 };
  const v: D4 = e.flipV ? { a: 2, f: 1 } : { a: 0, f: 0 };
  const r: D4 = { a: ((e.rotate / 90) % 4) as D4["a"], f: 0 };
  return composeD4(r, composeD4(v, h));
}

/** P ∘ Q (apply Q, then P). */
function composeD4(p: D4, q: D4): D4 {
  return {
    a: ((((p.a + (p.f ? -q.a : q.a)) % 4) + 4) % 4) as D4["a"],
    f: ((p.f + q.f) % 2) as D4["f"],
  };
}

function inverseD4(p: D4): D4 {
  // f=1 elements are involutions; f=0 are pure rotations.
  return p.f ? p : { a: (((4 - p.a) % 4) as D4["a"]), f: 0 };
}

export interface PreviewTransform {
  /** Clockwise rotation in degrees: 0 | 90 | 180 | 270. */
  deg: number;
  /** Whether to also mirror horizontally (scaleX(-1)). */
  mirror: boolean;
}

export function previewTransform(
  saved: PhotoEdits | null,
  working: PhotoEdits | null,
): PreviewTransform {
  const s = recipeToD4(saved ?? NO_EDITS);
  const w = recipeToD4(working ?? NO_EDITS);
  const d = composeD4(w, inverseD4(s)); // delta = working ∘ saved⁻¹
  return { deg: d.a * 90, mirror: d.f === 1 };
}
