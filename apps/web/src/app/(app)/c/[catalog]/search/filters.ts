import { DEFAULT_PHOTO_SORT, type FilterRule, MatchType, type PhotoSort, parseFilterTokens } from "@lumio/shared";

/**
 * The structured search state the rest of the app consumes. `rules` are the EXIF
 * filter rules parsed from the box text (album chips + free text are separate).
 */
export interface SearchFilters {
  albums: string[];
  q: string;
  rules: FilterRule[];
  match: MatchType;
}

/** Build normalized filters from album ids + the box's raw text. EXIF tokens in the
 *  text are parsed into `rules`; the remaining free text becomes `q`. */
export function buildFilters(albums: string[], rawText: string): SearchFilters {
  // Normalize non-breaking spaces the contenteditable can insert before tokenizing.
  const { rules, text } = parseFilterTokens(rawText.replace(/\u00A0/g, " ").trim());
  return {
    albums: Array.from(new Set(albums.filter(Boolean))),
    q: text,
    rules,
    match: MatchType.all,
  };
}

/** Filters → query string for GET /api/search (album repeats; q + filter only when
 *  set; sort only when not the default). */
export function paramsFor(
  filters: SearchFilters,
  sort: PhotoSort = DEFAULT_PHOTO_SORT,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const album of filters.albums) params.append("album", album);
  if (filters.q) params.set("q", filters.q);
  if (filters.rules.length > 0) {
    params.set("filter", JSON.stringify({ match: filters.match, rules: filters.rules }));
  }
  if (sort !== DEFAULT_PHOTO_SORT) params.set("sort", sort);
  return params;
}

/** Stable key for remounting the results grid when the filters change. */
export function serialize(filters: SearchFilters): string {
  return JSON.stringify({ albums: [...filters.albums].sort(), q: filters.q, rules: filters.rules, match: filters.match });
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
