/** Public, token-scoped rendition URLs for the share gallery. */
export function shareThumbUrl(token: string, id: string, version: number): string {
  return `/api/share/${encodeURIComponent(token)}/photos/${id}/thumbnail?v=${version}`;
}
export function shareDisplayUrl(token: string, id: string, version: number): string {
  return `/api/share/${encodeURIComponent(token)}/photos/${id}/display?v=${version}`;
}
export function shareDownloadUrl(token: string, id: string): string {
  return `/api/share/${encodeURIComponent(token)}/photos/${id}/download`;
}
export function shareDownloadAllUrl(token: string): string {
  return `/api/share/${encodeURIComponent(token)}/download-all`;
}
export function sharePhotosEndpoint(token: string): string {
  return `/api/share/${encodeURIComponent(token)}/photos`;
}
