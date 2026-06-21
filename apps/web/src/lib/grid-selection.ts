/**
 * Pure selection reducer for the photo grid. Given the current selected set and
 * a click at `index` (with the ordered photo id list), returns the next set.
 * - Plain click: select only the photo at `index`, dropping any prior selection.
 * - ⌘/Ctrl click (`toggle`): add/remove the single photo at `index`, keeping the
 *   rest of the selection — this is how you build a multi-selection.
 * - Shift click with a valid `anchorIndex`: additively select the inclusive range
 *   between the anchor and the clicked index (either direction), so it composes
 *   with photos already picked via ⌘/Ctrl clicks.
 * - Shift click with no anchor: behaves like a plain single select.
 */
export function computeSelection(
  current: Set<string>,
  photoIds: string[],
  index: number,
  modifiers: { shift: boolean; toggle: boolean },
  anchorIndex: number | null,
): Set<string> {
  if (modifiers.shift && anchorIndex !== null) {
    const next = new Set(current);
    const lo = Math.min(anchorIndex, index);
    const hi = Math.max(anchorIndex, index);
    for (let i = lo; i <= hi; i++) {
      const id = photoIds[i];
      if (id) next.add(id);
    }
    return next;
  }

  const id = photoIds[index];
  if (!id) return new Set(current);

  if (modifiers.toggle) {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }

  // Plain click (and shift-without-anchor): replace the selection with this one.
  return new Set([id]);
}
