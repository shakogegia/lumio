// Minimal client for the server's per-catalog photo endpoints. Auth is the
// Better Auth session cookie (from the Expo client's getCookie()), same as
// catalog-api.ts. Photo/page shapes are the real API contract from
// @lumio/shared, imported TYPE-ONLY so nothing from the shared barrel is bundled
// into the RN app (a value import would pull the whole shared graph, incl.
// Node-only modules, into Hermes).

import type { PhotoDTO, PhotosPage } from "@lumio/shared";

/** One page of the active catalog's photos (server default sort = newest
 *  imported first). Offset-paginated; `limit` is capped at 100 by the server. */
export async function fetchPhotos(
  baseURL: string,
  slug: string,
  cookie: string,
  opts: { limit: number; offset: number },
): Promise<PhotosPage> {
  const query = new URLSearchParams({
    limit: String(opts.limit),
    offset: String(opts.offset),
  });
  let res: Response;
  try {
    res = await fetch(`${baseURL}/api/c/${slug}/photos?${query}`, {
      headers: { accept: "application/json", Cookie: cookie },
    });
  } catch {
    throw new Error("Couldn't reach the server.");
  }
  if (!res.ok) {
    throw new Error(`Couldn't load photos (${res.status}).`);
  }
  return (await res.json()) as PhotosPage;
}

/** Authenticated WebP thumbnail URL for a photo. Cache-busted by updatedAt so an
 *  applied edit re-fetches — same convention as the web app's rendition-url. */
export function thumbnailUrl(
  baseURL: string,
  slug: string,
  photo: Pick<PhotoDTO, "id" | "updatedAt">,
): string {
  return `${baseURL}/api/c/${slug}/photos/${photo.id}/thumbnail?v=${Date.parse(photo.updatedAt)}`;
}
