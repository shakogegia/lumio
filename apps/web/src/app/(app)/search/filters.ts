/** The structured search state the rest of the app consumes. */
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

/** Filters → query string for GET /api/search (album repeats; q only when set). */
export function paramsFor(filters: SearchFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const album of filters.albums) params.append("album", album);
  if (filters.q) params.set("q", filters.q);
  return params;
}

/** Stable key for remounting the results grid when the filters change. */
export function serialize(filters: SearchFilters): string {
  return JSON.stringify({ albums: [...filters.albums].sort(), q: filters.q });
}
