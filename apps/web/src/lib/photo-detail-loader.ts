import { buildSearchWhere } from "@lumio/db";
import { listAlbumSummaries } from "@/lib/albums-service";
import { getNeighborsForWhere, getPhoto, getPhotoNeighbors } from "@/lib/photos-service";
import type { DetailScope } from "./detail-scope";

// The scope type + parse/serialize helpers moved to the client-safe
// `./detail-scope` module (so Client Components can import them without pulling
// in this file's server-only @lumio/db dependency). Re-exported here so existing
// server-side callers keep importing them from `@/lib/photo-detail-loader`.
export { parseDetailScope, detailScopeQuery } from "./detail-scope";
export type { DetailScope } from "./detail-scope";

export interface PhotoDetailData {
  photo: NonNullable<Awaited<ReturnType<typeof getPhoto>>>;
  regularAlbums: Awaited<ReturnType<typeof listAlbumSummaries>>;
  neighbors: Awaited<ReturnType<typeof getPhotoNeighbors>>;
}

/**
 * Loads everything the detail view needs: the photo, the regular albums (for the
 * membership checkboxes), and the prev/next + film-strip neighbors scoped per
 * `scope` (album / search results / whole library). Returns null when the photo
 * is missing so callers can `notFound()`.
 */
export async function loadPhotoDetail(
  catalogId: string,
  id: string,
  scope: DetailScope,
): Promise<PhotoDetailData | null> {
  const photo = await getPhoto(catalogId, id);
  if (!photo) return null;
  const current = { id: photo.id, path: photo.path };
  const neighbors$ =
    scope.kind === "album"
      ? getPhotoNeighbors(catalogId, current, scope.albumId, scope.sort)
      : scope.kind === "search"
        ? getNeighborsForWhere(
            current,
            { catalogId, ...buildSearchWhere({ album: scope.albums, q: scope.q }) },
            scope.sort,
          )
        : getPhotoNeighbors(catalogId, current, null, scope.sort);
  const [albums, neighbors] = await Promise.all([listAlbumSummaries(catalogId), neighbors$]);
  return {
    photo,
    regularAlbums: albums.filter((a) => !a.isSmart),
    neighbors,
  };
}
