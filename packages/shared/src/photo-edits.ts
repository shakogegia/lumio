import type { PhotoEdits } from "./types.js";

export const NO_EDITS: PhotoEdits = { rotate: 0, flipH: false, flipV: false };

/** True when the recipe changes the image (non-null and not the identity). */
export function hasEdits(e: PhotoEdits | null): boolean {
  return e !== null && (e.rotate !== 0 || e.flipH || e.flipV);
}

/** Structural equality of two recipes. */
export function sameEdits(a: PhotoEdits, b: PhotoEdits): boolean {
  return a.rotate === b.rotate && a.flipH === b.flipH && a.flipV === b.flipV;
}

function withRotate(e: PhotoEdits, rotate: number): PhotoEdits {
  return { ...e, rotate: (((rotate % 360) + 360) % 360) as PhotoEdits["rotate"] };
}

export function rotateRight(e: PhotoEdits): PhotoEdits {
  return withRotate(e, e.rotate + 90);
}

export function rotateLeft(e: PhotoEdits): PhotoEdits {
  return withRotate(e, e.rotate - 90);
}

/** When rotated 90/270 the on-screen axes are swapped, so a "flip horizontal"
 *  button must toggle the stored vertical flip (and vice-versa) to stay visually
 *  intuitive. The stored recipe remains canonical. */
function axisSwapped(e: PhotoEdits): boolean {
  return e.rotate === 90 || e.rotate === 270;
}

export function toggleFlipH(e: PhotoEdits): PhotoEdits {
  return axisSwapped(e) ? { ...e, flipV: !e.flipV } : { ...e, flipH: !e.flipH };
}

export function toggleFlipV(e: PhotoEdits): PhotoEdits {
  return axisSwapped(e) ? { ...e, flipH: !e.flipH } : { ...e, flipV: !e.flipV };
}

/** Predicted [width, height] after the recipe (rotate 90/270 swaps). */
export function orientedSize(w: number, h: number, e: PhotoEdits | null): [number, number] {
  return e && (e.rotate === 90 || e.rotate === 270) ? [h, w] : [w, h];
}

/** Defensively coerce an unknown JSON value (e.g. from the DB) into a recipe or
 *  null. Shared by the DTO mapper and the edited-download encoder. */
export function coercePhotoEdits(value: unknown): PhotoEdits | null {
  if (!value || typeof value !== "object") return null;
  const e = value as Record<string, unknown>;
  if (![0, 90, 180, 270].includes(e.rotate as number)) return null;
  if (typeof e.flipH !== "boolean" || typeof e.flipV !== "boolean") return null;
  return { rotate: e.rotate as PhotoEdits["rotate"], flipH: e.flipH, flipV: e.flipV };
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
