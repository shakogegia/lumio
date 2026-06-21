import { hasEdits, type PhotoDTO } from "@lumio/shared";

/** A cache-bust token derived from updatedAt; changes whenever renditions are
 *  regenerated (edits applied/reset). */
export function renditionVersion(updatedAt: string): number {
  return Date.parse(updatedAt);
}

export function thumbUrl(photo: Pick<PhotoDTO, "id" | "updatedAt">): string {
  return `/api/thumbnails/${photo.id}?v=${renditionVersion(photo.updatedAt)}`;
}

/** Display rendition for VIEWS: the baked `edited.webp` when the photo has edits,
 *  else the edit-free base. The base never changes, so it needs no cache-bust. */
export function displayUrl(photo: Pick<PhotoDTO, "id" | "updatedAt" | "edits">): string {
  return hasEdits(photo.edits)
    ? `/api/photos/${photo.id}/display?edited=1&v=${renditionVersion(photo.updatedAt)}`
    : `/api/photos/${photo.id}/display`;
}

/** Edit-free base display — the editor canvas source (static, no decode). */
export function baseDisplayUrl(photo: Pick<PhotoDTO, "id">): string {
  return `/api/photos/${photo.id}/display`;
}
