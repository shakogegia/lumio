/** Build a catalog-scoped API URL: catalogApiUrl("fam", "/photos") → "/api/c/fam/photos". */
export function catalogApiUrl(slug: string, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `/api/c/${encodeURIComponent(slug)}${p}`;
}

/** Build a catalog-scoped PAGE path: catalogPath("fam", "/photos") → "/c/fam/photos". */
export function catalogPath(slug: string, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `/c/${encodeURIComponent(slug)}${p}`;
}
