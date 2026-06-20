/**
 * The id set a per-photo action should operate on. Selection-aware: if the
 * photo is part of the current multi-selection, act on the whole selection;
 * otherwise act on just that one photo. Never mutates the selection.
 */
export function resolveTargets(
  selectedIds: Set<string> | undefined,
  photoId: string,
): string[] {
  return selectedIds?.has(photoId) ? [...selectedIds] : [photoId];
}
