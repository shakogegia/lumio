import type { PhotoDTO } from "@lumio/shared";

/** A cache-bust token derived from updatedAt; changes whenever renditions are
 *  regenerated (edits applied/reset). */
export function renditionVersion(updatedAt: string): number {
  return Date.parse(updatedAt);
}

export function thumbUrl(photo: Pick<PhotoDTO, "id" | "updatedAt">): string {
  return `/api/thumbnails/${photo.id}?v=${renditionVersion(photo.updatedAt)}`;
}

/** Display rendition for VIEWS: the server returns the current image — the baked
 *  `edited.webp` if it exists, else the edit-free base. Always versioned so an
 *  Apply busts the cache (the base is content-stable, so the redundant bust on an
 *  unrelated update just re-serves identical bytes — same as the thumbnail). */
export function displayUrl(photo: Pick<PhotoDTO, "id" | "updatedAt">): string {
  return `/api/photos/${photo.id}/display?v=${renditionVersion(photo.updatedAt)}`;
}

/** Edit-free base display — the editor canvas source (static, immutable, no decode). */
export function baseDisplayUrl(photo: Pick<PhotoDTO, "id">): string {
  return `/api/photos/${photo.id}/display?base=1`;
}
