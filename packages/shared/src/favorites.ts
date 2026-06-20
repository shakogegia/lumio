import type { PhotoDTO } from "./types.js";

/**
 * Smart-toggle target for a favorite action over a set of photos: favorite all
 * of them unless every one is already favorited, in which case unfavorite all.
 * An empty set favorites (returns true).
 */
export function computeFavoriteTarget(
  photos: Pick<PhotoDTO, "isFavorite">[],
): boolean {
  return !(photos.length > 0 && photos.every((p) => p.isFavorite));
}
