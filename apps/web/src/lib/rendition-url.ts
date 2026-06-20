import type { PhotoDTO } from "@lumio/shared";

/** A cache-bust token derived from updatedAt; changes whenever renditions are
 *  regenerated (edits applied/reset). */
export function renditionVersion(updatedAt: string): number {
  return Date.parse(updatedAt);
}

export function thumbUrl(photo: Pick<PhotoDTO, "id" | "updatedAt">): string {
  return `/api/thumbnails/${photo.id}?v=${renditionVersion(photo.updatedAt)}`;
}

export function displayUrl(photo: Pick<PhotoDTO, "id" | "updatedAt">): string {
  return `/api/photos/${photo.id}/display?v=${renditionVersion(photo.updatedAt)}`;
}
