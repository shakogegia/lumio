export type ArrowKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

/**
 * Clamped neighbor index for an arrow key in a `columns`-wide grid of `count`
 * items. A null cursor (nothing focused yet) lands on the first item. Movement
 * never wraps: a blocked move returns the current index unchanged.
 */
export function nextGridIndex(
  current: number | null,
  key: ArrowKey,
  columns: number,
  count: number,
): number {
  // Callers must gate on `count > 0`: an empty grid has no valid index (the
  // nav hook already guards this). The `<= 0` branch is a defensive fallback.
  if (count <= 0) return 0;
  if (current === null) return 0;
  const i = Math.min(Math.max(current, 0), count - 1);
  switch (key) {
    case "ArrowLeft":
      return i > 0 ? i - 1 : i;
    case "ArrowRight":
      return i < count - 1 ? i + 1 : i;
    case "ArrowUp":
      return i - columns >= 0 ? i - columns : i;
    case "ArrowDown":
      return i + columns < count ? i + columns : i;
  }
}

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

/**
 * Selection after an arrow move to `leadIndex`. Shift extends the inclusive
 * range from the anchor (replace-with-range, so it grows and shrinks as the
 * cursor moves); a plain move selects only the cursor. Unlike `computeSelection`'s
 * additive shift-click range, this REPLACES the selection with the anchor→lead
 * range rather than merging it into the prior set. Holes (unloaded indices,
 * via a sparse `idAt`) are skipped. `idAt` lets the virtualized photo grid avoid
 * materializing a full id array on every keystroke.
 */
export function arrowSelection(
  idAt: (index: number) => string | undefined,
  leadIndex: number,
  shift: boolean,
  anchorIndex: number | null,
): Set<string> {
  if (shift && anchorIndex !== null) {
    const lo = Math.min(anchorIndex, leadIndex);
    const hi = Math.max(anchorIndex, leadIndex);
    const next = new Set<string>();
    for (let i = lo; i <= hi; i++) {
      const id = idAt(i);
      if (id) next.add(id);
    }
    return next;
  }
  const id = idAt(leadIndex);
  return id ? new Set([id]) : new Set();
}
