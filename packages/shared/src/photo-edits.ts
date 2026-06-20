import type { PhotoEdits } from "./types.js";

export const NO_EDITS: PhotoEdits = { rotate: 0, flipH: false, flipV: false };

/** True when the recipe changes the image (non-null and not the identity). */
export function hasEdits(e: PhotoEdits | null): boolean {
  return e !== null && (e.rotate !== 0 || e.flipH || e.flipV);
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
