/**
 * Pure selection reducer for the photo grid. Given the current selected set and
 * a click at `index` (with the ordered photo id list), returns the next set.
 * - Plain click: toggle the single photo at `index`.
 * - Shift-click with a valid `anchorIndex`: additively select the inclusive
 *   range between the anchor and the clicked index (either direction).
 * - Shift-click with no anchor: behaves like a plain toggle.
 */
export function computeSelection(
  current: Set<string>,
  photoIds: string[],
  index: number,
  shiftKey: boolean,
  anchorIndex: number | null,
): Set<string> {
  const next = new Set(current);

  if (shiftKey && anchorIndex !== null) {
    const lo = Math.min(anchorIndex, index);
    const hi = Math.max(anchorIndex, index);
    for (let i = lo; i <= hi; i++) {
      const id = photoIds[i];
      if (id) next.add(id);
    }
    return next;
  }

  const id = photoIds[index];
  if (!id) return next;
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
