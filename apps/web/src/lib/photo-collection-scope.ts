import { catalogApiUrl } from "@/lib/catalog-api";
import { type DetailScope, detailScopeQuery } from "@/lib/detail-scope";

export interface CollectionSource {
  /** List API the shared store paginates. */
  endpoint: string;
  /** Query params for that list API (matches what the grid views already send). */
  params: URLSearchParams;
  /** Detail URL for a photo id, carrying the scope (for pushState/replaceState). */
  urlForId: (id: string) => string;
  /** Grid URL to return to when the lightbox closes from a deep link. */
  baseUrl: string;
}

/**
 * Derive the shared store's endpoint/params, the per-photo detail URL, and the
 * grid URL for a navigation scope. Used by the deep-link route (which has no grid
 * view to borrow from). `urlForId` reuses `detailScopeQuery`, the one place the
 * ?album/?s/?q/?sort convention is defined, so URLs match `photoHref`.
 */
export function collectionForScope(slug: string, scope: DetailScope): CollectionSource {
  const query = detailScopeQuery(scope);
  const urlForId = (id: string) => (query ? `/photo/${id}?${query}` : `/photo/${id}`);

  if (scope.kind === "album") {
    return {
      endpoint: catalogApiUrl(slug, `/albums/${scope.albumId}/photos`),
      params: new URLSearchParams({ sort: scope.sort }),
      urlForId,
      baseUrl: `/albums/${scope.albumId}`,
    };
  }
  if (scope.kind === "search") {
    const params = new URLSearchParams();
    for (const a of scope.albums) params.append("album", a);
    if (scope.q) params.set("q", scope.q);
    params.set("sort", scope.sort);
    return { endpoint: catalogApiUrl(slug, "/search"), params, urlForId, baseUrl: "/search" };
  }
  return {
    endpoint: catalogApiUrl(slug, "/photos"),
    params: new URLSearchParams({ sort: scope.sort }),
    urlForId,
    baseUrl: "/photos",
  };
}
