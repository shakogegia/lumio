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
