import { thumbHashToDataURL } from "thumbhash";

/**
 * Decode a base64 ThumbHash to a blurred-preview data URL, or null when the hash
 * is absent or malformed. Shared by the grid tile and the photo detail view so
 * the decode (base64 → bytes → data URL) lives in one place.
 */
export function thumbhashDataUrl(thumbhash: string | null | undefined): string | null {
  if (!thumbhash) return null;
  try {
    const bytes = Uint8Array.from(atob(thumbhash), (c) => c.charCodeAt(0));
    return thumbHashToDataURL(bytes);
  } catch {
    return null;
  }
}
