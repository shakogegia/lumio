import type { CropRect, CurvePoint, CurveSpec, PhotoEdits } from "./types.js";
import { centeredAspectCrop, straightenedSize } from "./crop-geometry.js";
import { COLOR_FIELDS, hasColor, isWbKey } from "./photo-color.js";

/** Current edit-recipe schema version. Stamped on every coerced/saved recipe so a
 *  shape change can branch on it at the read boundary. v2 added
 *  highlights/shadows/whites/blacks/vibrance + tone curves. v3 changed the *units*
 *  of exposure (→ EV stops), temperature (→ Kelvin), brightness (→ midtone gamma),
 *  and vignette (→ bidirectional); legacy recipes are migrated on read (see
 *  migrateColor). */
export const EDITS_VERSION = 3;

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

function samePoints(a: CurvePoint[] | undefined, b: CurvePoint[] | undefined): boolean {
  const an = a ?? [];
  const bn = b ?? [];
  if (an.length !== bn.length) return false;
  for (let i = 0; i < an.length; i++) if (an[i]!.x !== bn[i]!.x || an[i]!.y !== bn[i]!.y) return false;
  return true;
}

function sameCurves(a: CurveSpec | undefined, b: CurveSpec | undefined): boolean {
  return (
    samePoints(a?.master, b?.master) &&
    samePoints(a?.r, b?.r) &&
    samePoints(a?.g, b?.g) &&
    samePoints(a?.b, b?.b)
  );
}

/** Structural equality of two recipes. */
export function sameEdits(a: PhotoEdits, b: PhotoEdits): boolean {
  return (
    a.rotate === b.rotate &&
    a.flipH === b.flipH &&
    a.flipV === b.flipV &&
    (a.straighten ?? 0) === (b.straighten ?? 0) &&
    sameCrop(a.crop, b.crop) &&
    // White-balance keys compare by presence+value (absent === absent, present must
    // match); other keys treat their global neutral as equal to absent. See isWbKey.
    COLOR_FIELDS.every((f) =>
      isWbKey(f.key) ? a[f.key] === b[f.key] : (a[f.key] ?? f.neutral) === (b[f.key] ?? f.neutral),
    ) &&
    sameCurves(a.curves, b.curves)
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

/** The crop actually applied when previewing/baking `e` against an oriented base of
 *  `ow×oh` (post coarse-rotate). Explicit crop wins; else a straighten auto-fills a
 *  centered inscribed crop; else the full frame. Normalized to the straightened (O′)
 *  box — which equals the oriented frame (O) when straighten is 0. Single source for
 *  the 3 sites that used to inline this. */
export function effectiveCrop(e: PhotoEdits | null, ow: number, oh: number): CropRect {
  if (e?.crop) return e.crop;
  const deg = e?.straighten ?? 0;
  if (deg !== 0) return centeredAspectCrop(ow / oh, ow, oh, deg);
  return { x: 0, y: 0, w: 1, h: 1 };
}

/** Output { w, h } of the recipe applied to an oriented `ow×oh` base: straighten
 *  expands to the O′ box, then the effective crop selects a sub-rect. */
export function outputSize(e: PhotoEdits | null, ow: number, oh: number): { w: number; h: number } {
  const deg = e?.straighten ?? 0;
  const op = straightenedSize(ow, oh, deg);
  const crop = effectiveCrop(e, ow, oh);
  return {
    w: Math.max(1, Math.round(crop.w * op.w)),
    h: Math.max(1, Math.round(crop.h * op.h)),
  };
}

/** Predicted [width, height] after the recipe, for optimistic store patching.
 *  Thin wrapper over outputSize that first applies the coarse-rotate axis swap. */
export function orientedSize(w: number, h: number, e: PhotoEdits | null): [number, number] {
  if (!e) return [w, h];
  const [ow, oh] = e.rotate === 90 || e.rotate === 270 ? [h, w] : [w, h];
  const { w: W, h: H } = outputSize(e, ow, oh);
  return [W, H];
}

function coercePoints(value: unknown): CurvePoint[] | null {
  if (!Array.isArray(value)) return null;
  const pts: CurvePoint[] = [];
  for (const p of value) {
    if (!p || typeof p !== "object") return null;
    const x = (p as Record<string, unknown>).x;
    const y = (p as Record<string, unknown>).y;
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    pts.push({ x, y });
  }
  return pts;
}

/** Coerce an unknown JSON value into a CurveSpec, keeping only channels with ≥2
 *  valid points. Returns null when no usable curve is present. */
function coerceCurves(value: unknown): CurveSpec | null {
  if (!value || typeof value !== "object") return null;
  const c = value as Record<string, unknown>;
  const out: CurveSpec = {};
  let any = false;
  for (const ch of ["master", "r", "g", "b"] as const) {
    if (c[ch] === undefined) continue;
    const pts = coercePoints(c[ch]);
    if (pts && pts.length >= 2) {
      out[ch] = pts;
      any = true;
    }
  }
  return any ? out : null;
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

function numOrUndef(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Migrate a pre-v3 recipe's color fields to v3 units. v3 changed exposure to EV
 *  stops, temperature to Kelvin, brightness to a midtone gamma, and vignette to a
 *  bidirectional control — so legacy values would otherwise read as garbage (e.g. a
 *  stored `temperature: 50` would clamp to 2000 K). Best-effort, keeps the old look
 *  roughly intact. Geometry/curves are untouched. */
function migrateColor(e: Record<string, unknown>): Record<string, unknown> {
  if ((numOrUndef(e.version) ?? 0) >= 3) return e;
  const out: Record<string, unknown> = { ...e };
  const oldExp = numOrUndef(e.exposure);
  const oldBri = numOrUndef(e.brightness);
  if (oldExp !== undefined || oldBri !== undefined) {
    // old exposure was 2^(x/50) (±2 EV); old brightness was a redundant linear
    // multiply ×(1+b/100) — fold both into pure EV. New brightness starts neutral.
    const briMul = Math.max(Math.pow(2, -5), 1 + (oldBri ?? 0) / 100);
    out.exposure = (oldExp ?? 0) / 50 + Math.log2(briMul);
    out.brightness = 0;
  }
  const oldTemp = numOrUndef(e.temperature);
  if (oldTemp !== undefined) {
    // old −100(cool)..+100(warm) → Kelvin (warm = lower K): +100→4000K, −100→9000K.
    const t = Math.max(-100, Math.min(100, oldTemp));
    out.temperature = 6500 - (t / 100) * 2500;
  }
  const oldVig = numOrUndef(e.vignette);
  if (oldVig !== undefined && oldVig > 0) out.vignette = -oldVig; // old 0..100 darkened
  return out;
}

/** Defensively coerce an unknown JSON value (e.g. from the DB) into a recipe or
 *  null. Shared by the DTO mapper and the edited-download encoder. */
export function coercePhotoEdits(value: unknown): PhotoEdits | null {
  if (!value || typeof value !== "object") return null;
  const e = migrateColor(value as Record<string, unknown>);
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
      // WB keys (temperature/tint) have no in-band neutral — keep any present value
      // (the editor only stores them off the per-photo baseline). Other keys drop
      // at their global neutral. See isWbKey in photo-color.
      if (isWbKey(f.key) || clamped !== f.neutral) out[f.key] = clamped;
    }
  }
  const curves = coerceCurves(e.curves);
  if (curves) out.curves = curves;
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
