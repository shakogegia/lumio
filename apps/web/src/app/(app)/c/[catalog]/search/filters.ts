import { DEFAULT_PHOTO_SORT, type PhotoSort } from "@lumio/shared";

/**
 * The structured search state the rest of the app consumes.
 *
 * NOTE: only the `album` facet is wired end-to-end today. Adding a new facet
 * (e.g. camera) means: one entry in FACETS (menu + chip), PLUS wiring its value
 * through readEditor → SearchFilters → paramsFor and the /api/search backend
 * (each facet maps to a different filter, so this part is intentionally bespoke).
 */
export interface SearchFilters {
  albums: string[];
  q: string;
}

/** Build normalized filters from raw album ids + free text (deduped, trimmed). */
export function buildFilters(albums: string[], rawText: string): SearchFilters {
  return {
    albums: Array.from(new Set(albums.filter(Boolean))),
    q: rawText.replace(/ /g, " ").trim(),
  };
}

/** Filters → query string for GET /api/search (album repeats; q only when set;
 *  sort only when not the default). */
export function paramsFor(
  filters: SearchFilters,
  sort: PhotoSort = DEFAULT_PHOTO_SORT,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const album of filters.albums) params.append("album", album);
  if (filters.q) params.set("q", filters.q);
  if (sort !== DEFAULT_PHOTO_SORT) params.set("sort", sort);
  return params;
}

/** Stable key for remounting the results grid when the filters change. */
export function serialize(filters: SearchFilters): string {
  return JSON.stringify({ albums: [...filters.albums].sort(), q: filters.q });
}

/**
 * Query string carried on a result photo's detail URL so the detail view scopes
 * its prev/next + film strip to the search results. The `s=1` marker tells the
 * detail page to treat the params as a search filter (vs. the album scope).
 */
export function scopeQuery(
  filters: SearchFilters,
  sort: PhotoSort = DEFAULT_PHOTO_SORT,
): string {
  const params = paramsFor(filters, sort);
  params.set("s", "1");
  return params.toString();
}
