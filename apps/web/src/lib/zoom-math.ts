/** Pure geometry for the photo-detail zoom & pan. No React, no DOM. */

export interface Size {
  width: number;
  height: number;
}

export interface Offset {
  x: number;
  y: number;
}

/** Maximum zoom, as a percentage of the original's 1:1 pixels. */
export const MAX_ZOOM = 100 * 4;

/** Canonical zoom stops above fit, for the +/- buttons. */
const STOPS_ABOVE_FIT = [100, 200, 300, 400];

/** Small tolerance so a slider value sitting on/near a stop still advances. */
const STOP_EPSILON = 0.5;

/**
 * Fit zoom as a percentage. The image is scaled to fit the viewport but never
 * upscaled past 100% (a small photo sits at its native size, centered).
 * Returns 100 before the viewport has been measured.
 */
export function computeFitZoom(photo: Size, viewport: Size): number {
  if (photo.width <= 0 || photo.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return 100;
  }
  const scale = Math.min(viewport.width / photo.width, viewport.height / photo.height, 1);
  return scale * 100;
}

/** Clamp a zoom percentage into [fitZoom, MAX_ZOOM]. */
export function clampZoom(zoom: number, fitZoom: number): number {
  return Math.min(Math.max(zoom, fitZoom), MAX_ZOOM);
}

/** Stops for the +/- buttons: fit, then each 100-step strictly above fit. */
export function computeStops(fitZoom: number): number[] {
  return [fitZoom, ...STOPS_ABOVE_FIT.filter((s) => s > fitZoom)];
}

/** The next stop strictly above the current zoom (caps at the top stop). */
export function nextStop(zoom: number, stops: number[]): number {
  for (const s of stops) {
    if (s > zoom + STOP_EPSILON) return s;
  }
  return stops[stops.length - 1];
}

/** The previous stop strictly below the current zoom (floors at the first stop). */
export function prevStop(zoom: number, stops: number[]): number {
  for (let i = stops.length - 1; i >= 0; i--) {
    if (stops[i] < zoom - STOP_EPSILON) return stops[i];
  }
  return stops[0];
}

/** The rendered CSS size of the image at a given zoom percentage. */
export function scaledSize(photo: Size, zoom: number): Size {
  return { width: (photo.width * zoom) / 100, height: (photo.height * zoom) / 100 };
}

/**
 * Clamp a pan offset (the image center's displacement from the viewport center,
 * in CSS px). Each axis is limited to the scaled image's overflow; an axis where
 * the image is smaller than the viewport locks to 0 (stays centered).
 */
export function clampOffset(offset: Offset, scaled: Size, viewport: Size): Offset {
  const maxX = Math.max(0, (scaled.width - viewport.width) / 2);
  const maxY = Math.max(0, (scaled.height - viewport.height) / 2);
  return {
    x: Math.min(Math.max(offset.x, -maxX), maxX) || 0,
    y: Math.min(Math.max(offset.y, -maxY), maxY) || 0,
  };
}

/**
 * New offset that keeps the image point under `cursor` fixed across a zoom
 * change. `cursor` is relative to the viewport center, in CSS px. Independent of
 * fit scale because the transform scale ratio equals fromZoom→toZoom ratio.
 *
 *   offset' = cursor - (toZoom / fromZoom) * (cursor - offset)
 */
export function zoomToward(cursor: Offset, fromZoom: number, toZoom: number, offset: Offset): Offset {
  const k = toZoom / fromZoom;
  return {
    x: cursor.x - k * (cursor.x - offset.x),
    y: cursor.y - k * (cursor.y - offset.y),
  };
}
