import { coercePhotoSort, DEFAULT_PHOTO_SORT, type PhotoSort } from "@lumio/shared";

// Pure scope helpers — NO server-only imports (no @lumio/db, no prisma), so this
// module is safe to import from Client Components. `photo-detail-loader.ts`
// (server-only) re-exports these for its existing callers.

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
