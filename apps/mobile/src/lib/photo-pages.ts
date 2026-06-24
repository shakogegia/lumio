// Pure pagination helpers for usePhotoPages. Kept React-free so they're trivially
// unit-testable; the hook composes them.

/** Append `incoming` to `prev`, dropping any whose id is already present (keeps
 *  the grid stable if the server returns an overlapping page). */
export function mergeById<T extends { id: string }>(prev: T[], incoming: T[]): T[] {
  if (prev.length === 0) return incoming;
  const seen = new Set(prev.map((x) => x.id));
  return [...prev, ...incoming.filter((x) => !seen.has(x.id))];
}

/** Whether more pages remain (fewer loaded than the reported total). */
export function hasMore(loaded: number, total: number): boolean {
  return loaded < total;
}
