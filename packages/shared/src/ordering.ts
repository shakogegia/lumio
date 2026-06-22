import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

/** A row participating in ordering: its id and its current fractional key (or null if unset). */
export interface OrderedItem {
  id: string;
  position: string | null;
}

/** A persisted position change for one row. */
export interface PositionUpdate {
  id: string;
  position: string;
}

/** Generate `count` evenly spaced keys strictly between `before` and `after` (either may be null = open end). */
export function keysBetween(
  before: string | null,
  after: string | null,
  count: number,
): string[] {
  return generateNKeysBetween(before, after, count);
}

/**
 * Compute the position updates needed to move `movedId` so it sits immediately
 * after `afterId` in `items` (afterId === null moves it to the front).
 *
 * `items` MUST already be in display order. Any `null` positions are first
 * backfilled with fractional keys that preserve the current display order
 * (those backfills are included in the returned updates). The moved row then
 * gets a key strictly between its new neighbors. Returns the minimal set of
 * changed rows — usually just the moved row, plus any rows that had to be
 * backfilled.
 *
 * Throws if `movedId` (or a non-null `afterId`) is not present in `items`.
 */
export function computeReorder(
  items: OrderedItem[],
  movedId: string,
  afterId: string | null,
): PositionUpdate[] {
  if (!items.some((i) => i.id === movedId)) {
    throw new Error(`computeReorder: movedId "${movedId}" not found`);
  }
  if (afterId !== null && !items.some((i) => i.id === afterId)) {
    throw new Error(`computeReorder: afterId "${afterId}" not found`);
  }
  if (afterId === movedId) {
    throw new Error(`computeReorder: afterId cannot equal movedId`);
  }

  // 1) Materialize a fully-keyed view in display order, recording backfills.
  const updates: PositionUpdate[] = [];
  const keyBy: Record<string, string> = {};
  let i = 0;
  while (i < items.length) {
    if (items[i]!.position !== null) {
      keyBy[items[i]!.id] = items[i]!.position as string;
      i += 1;
      continue;
    }
    // Run of consecutive nulls between two keyed anchors (either may be open).
    const before = i > 0 ? keyBy[items[i - 1]!.id]! : null;
    let j = i;
    while (j < items.length && items[j]!.position === null) j += 1;
    const after = j < items.length ? (items[j]!.position as string) : null;
    const fresh = keysBetween(before, after, j - i);
    for (let k = i; k < j; k += 1) {
      keyBy[items[k]!.id] = fresh[k - i]!;
      updates.push({ id: items[k]!.id, position: fresh[k - i]! });
    }
    i = j;
  }

  // 2) Determine the moved row's new neighbors in the order WITHOUT the moved row.
  const order = items.map((it) => it.id).filter((id) => id !== movedId);
  const insertAfter = afterId === null ? -1 : order.indexOf(afterId);
  const beforeKey = insertAfter >= 0 ? keyBy[order[insertAfter]!]! : null;
  const afterKey =
    insertAfter + 1 < order.length ? keyBy[order[insertAfter + 1]!]! : null;
  const newKey = generateKeyBetween(beforeKey, afterKey);

  // 3) Emit the moved row's update (overriding any backfill it may have gotten),
  //    unless the key is unchanged vs. its ORIGINAL position (single-item /
  //    already-in-place). Comparing against the original (not the backfill key)
  //    ensures a null-positioned moved row always gets persisted.
  const origPosition = items.find((it) => it.id === movedId)!.position;
  if (newKey !== origPosition) {
    const without = updates.filter((u) => u.id !== movedId);
    without.push({ id: movedId, position: newKey });
    return without;
  }
  return updates.filter((u) => u.id !== movedId);
}
