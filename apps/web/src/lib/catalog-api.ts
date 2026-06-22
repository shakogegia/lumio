/** Build a catalog-scoped API URL: catalogApiUrl("fam", "/photos") → "/api/c/fam/photos". */
export function catalogApiUrl(slug: string, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `/api/c/${encodeURIComponent(slug)}${p}`;
}
