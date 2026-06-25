/** Public, token-scoped rendition URLs for the share gallery. */
export function shareThumbUrl(token: string, id: string, version: number): string {
  return `/api/share/${encodeURIComponent(token)}/photos/${id}/thumbnail?v=${version}`;
}
export function shareDisplayUrl(token: string, id: string, version: number): string {
  return `/api/share/${encodeURIComponent(token)}/photos/${id}/display?v=${version}`;
}
/** Inline full-res (baked) rendition for the lightbox deep-zoom. */
export function shareFullUrl(token: string, id: string): string {
  return `/api/share/${encodeURIComponent(token)}/photos/${id}/full`;
}
export function shareDownloadUrl(token: string, id: string): string {
  return `/api/share/${encodeURIComponent(token)}/photos/${id}/download`;
}
export function shareDownloadAllUrl(token: string): string {
  return `/api/share/${encodeURIComponent(token)}/download-all`;
}
/** Subset zip: POST { ids } here for a multi-photo download. */
export function shareDownloadSelectedUrl(token: string): string {
  return `/api/share/${encodeURIComponent(token)}/photos/download`;
}
export function sharePhotosEndpoint(token: string): string {
  return `/api/share/${encodeURIComponent(token)}/photos`;
}
