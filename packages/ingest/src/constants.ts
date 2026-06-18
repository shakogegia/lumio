/** Build-time thumbnail max edge (px). Changing this requires regenerating the cache. */
export const THUMBNAIL_MAX = 400;

/**
 * Build-time display-rendition max edge (px). The detail view renders this
 * instead of the original so non-browser formats (JXL/HEIC) display, and large
 * originals don't ship megabytes per view. Changing this requires regenerating
 * the cache.
 */
export const DISPLAY_MAX = 2048;

// Re-exported from @lumio/shared so the browser upload UI can import the list
// without pulling the Node-only ingest pipeline into the client bundle.
export { SUPPORTED_EXTENSIONS } from "@lumio/shared";
