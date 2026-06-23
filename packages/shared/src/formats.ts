/**
 * Image file extensions (lowercase, leading dot) the system ingests.
 * Lives in @lumio/shared so both the Node ingest pipeline and the browser
 * upload UI can use it without the client bundling the Node-only pipeline.
 */
export const SUPPORTED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".jxl",
  ".heic",
  ".heif",
]);

/**
 * True if `filename`'s extension is one the system ingests (case-insensitive).
 * Pure string check — no filesystem access — so the browser can use it too.
 */
export function isSupportedImage(filename: string): boolean {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return false;
  return SUPPORTED_EXTENSIONS.has(filename.slice(dot).toLowerCase());
}
