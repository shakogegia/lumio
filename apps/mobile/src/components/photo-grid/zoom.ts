// Pure pinch -> zoom-level logic for the zoomable grid. `levels` is the ascending
// list of column counts (e.g. [1, 3, 5, 8]); a lower index means fewer columns
// and larger tiles. A pinch-out (scale > 1) zooms IN -> fewer columns (lower
// index); a pinch-in (scale < 1) -> more columns (higher index). Within the dead
// zone the level is unchanged. The result index is clamped to the array bounds.

export const ZOOM_IN_THRESHOLD = 1.15;
export const ZOOM_OUT_THRESHOLD = 0.87;

export function nextZoomLevel(levels: number[], index: number, scale: number): number {
  if (scale >= ZOOM_IN_THRESHOLD) return Math.max(0, index - 1);
  if (scale <= ZOOM_OUT_THRESHOLD) return Math.min(levels.length - 1, index + 1);
  return index;
}
