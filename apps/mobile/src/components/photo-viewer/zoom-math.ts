// Pure zoom/pan helpers for a viewer page. Marked 'worklet' so they run on the
// UI thread inside reanimated gesture callbacks; the directive is a no-op string
// in plain JS, so vitest exercises them normally.

export const MAX_ZOOM = 3;
export const DOUBLE_TAP_ZOOM = 2.5;

/** Clamp a pan offset so a `scale`d image can't be dragged past its edges:
 *  the slack on each axis is (scale - 1) * dimension / 2. */
export function clampOffset(value: number, scale: number, dimension: number): number {
  "worklet";
  const max = Math.max(0, ((scale - 1) * dimension) / 2);
  return Math.min(max, Math.max(-max, value));
}
