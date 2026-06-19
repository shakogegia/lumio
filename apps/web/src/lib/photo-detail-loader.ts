import { buildSearchWhere } from "@lumio/db";
import { coercePhotoSort, DEFAULT_PHOTO_SORT, type PhotoSort } from "@lumio/shared";
import { listAlbumSummaries } from "@/lib/albums-service";
import { getNeighborsForWhere, getPhoto, getPhotoNeighbors } from "@/lib/photos-service";

export interface PhotoDetailData {
  photo: NonNullable<Awaited<ReturnType<typeof getPhoto>>>;
  regularAlbums: Awaited<ReturnType<typeof listAlbumSummaries>>;
  neighbors: Awaited<ReturnType<typeof getPhotoNeighbors>>;
}

/**
 * The navigation scope of the detail view's prev/next + film strip. `album`
 * walks an album (regular or smart), `search` walks a search result set, and
 * `library` walks the whole library.
 */
export type DetailScope =
  | { kind: "album"; albumId: string; sort: PhotoSort }
  | { kind: "search"; albums: string[]; q?: string; sort: PhotoSort }
  | { kind: "library"; sort: PhotoSort };

type RawSearchParams = { album?: string | string[]; q?: string; s?: string; sort?: string };

/** Parse a detail route's query params into a scope. `s` marks a search scope. */
export function parseDetailScope(sp: RawSearchParams): DetailScope {
  const sort = coercePhotoSort(sp.sort);
  if (sp.s) {
    const albums = Array.isArray(sp.album) ? sp.album : sp.album ? [sp.album] : [];
    return {
      kind: "search",
      albums,
      q: typeof sp.q === "string" && sp.q ? sp.q : undefined,
      sort,
    };
  }
  if (typeof sp.album === "string") return { kind: "album", albumId: sp.album, sort };
  return { kind: "library", sort };
}

/** Serialize a scope back into the query string carried on prev/next/strip hrefs. */
export function detailScopeQuery(scope: DetailScope): string {
  const params = new URLSearchParams();
  if (scope.kind === "album") {
    params.set("album", scope.albumId);
  } else if (scope.kind === "search") {
    params.set("s", "1");
    for (const album of scope.albums) params.append("album", album);
    if (scope.q) params.set("q", scope.q);
  }
  if (scope.sort !== DEFAULT_PHOTO_SORT) params.set("sort", scope.sort);
  return params.toString();
}

/**
 * Loads everything the detail view needs: the photo, the regular albums (for the
 * membership checkboxes), and the prev/next + film-strip neighbors scoped per
 * `scope` (album / search results / whole library). Returns null when the photo
 * is missing so callers can `notFound()`.
 */
export async function loadPhotoDetail(
  id: string,
  scope: DetailScope,
): Promise<PhotoDetailData | null> {
  const photo = await getPhoto(id);
  if (!photo) return null;
  const current = { id: photo.id, path: photo.path };
  const neighbors$ =
    scope.kind === "album"
      ? getPhotoNeighbors(current, scope.albumId, scope.sort)
      : scope.kind === "search"
        ? getNeighborsForWhere(
            current,
            buildSearchWhere({ album: scope.albums, q: scope.q }),
            scope.sort,
          )
        : getPhotoNeighbors(current, null, scope.sort);
  const [albums, neighbors] = await Promise.all([listAlbumSummaries(), neighbors$]);
  return {
    photo,
    regularAlbums: albums.filter((a) => !a.isSmart),
    neighbors,
  };
}
