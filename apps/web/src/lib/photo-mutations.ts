import type { ColorLabel } from "@lumio/shared";
import { catalogApiUrl } from "@/lib/catalog-api";

// Single source of truth for photo-mutation network calls. Each function issues
// exactly one request and throws on failure. Callers own optimistic UI, toasts,
// sounds, and router.refresh — those vary by context, the request does not.

async function postJson(url: string, body: unknown): Promise<Response> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res;
}

export async function favoritePhotos(slug: string, photoIds: string[], isFavorite: boolean): Promise<void> {
  await postJson(catalogApiUrl(slug, "/photos/favorite"), { photoIds, isFavorite });
}

export async function setPhotoColorLabel(slug: string, photoIds: string[], label: ColorLabel | null): Promise<void> {
  await postJson(catalogApiUrl(slug, "/photos/color-label"), { photoIds, label });
}

export async function trashPhotos(slug: string, ids: string[]): Promise<void> {
  await postJson(catalogApiUrl(slug, "/photos/trash"), { ids });
}

export async function addPhotosToAlbum(slug: string, albumId: string, photoIds: string[]): Promise<void> {
  await postJson(catalogApiUrl(slug, `/albums/${albumId}/photos`), { photoIds });
}

export async function removePhotoFromAlbum(slug: string, albumId: string, photoId: string): Promise<void> {
  const res = await fetch(catalogApiUrl(slug, `/albums/${albumId}/photos/${photoId}`), { method: "DELETE" });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
}

// NOTE: album *creation* lives only in add-to-album-dialog (its body carries
// dialog-specific isSmart/folderId), so it stays there — not duplicated, no need
// to move it here. This module covers the mutations shared across callers.
