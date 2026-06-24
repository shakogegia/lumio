// Pure helpers for the fullscreen pager — React-free, unit-tested.

/** Clamp an index into [0, count-1] (or 0 when empty). */
export function clampIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.max(0, Math.min(index, count - 1));
}

/** Whether paging to `index` should request the next page (within `threshold`
 *  of the loaded end), so infinite scroll continues inside the viewer. */
export function shouldLoadMore(index: number, count: number, threshold = 3): boolean {
  return count > 0 && index >= count - threshold;
}
