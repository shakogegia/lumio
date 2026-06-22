import { DEFAULT_PHOTO_SORT, type PhotoSort } from "@lumio/shared";
import { catalogPath } from "@/lib/catalog-api";

/**
 * Catalog-scoped URL for a photo's detail route, carrying the navigation scope.
 * An album id scopes neighbors/film-strip to that album (else the whole
 * library); a sort (when not the default) tells the detail view which ordering
 * to walk. This is the one place the `?album=` / `?sort=` convention is defined.
 */
export function photoHref(
  slug: string,
  id: string,
  albumId?: string | null,
  sort?: PhotoSort,
): string {
  const params = new URLSearchParams();
  if (albumId) params.set("album", albumId);
  if (sort && sort !== DEFAULT_PHOTO_SORT) params.set("sort", sort);
  const qs = params.toString();
  return catalogPath(slug, qs ? `/photo/${id}?${qs}` : `/photo/${id}`);
}
