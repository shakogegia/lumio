/**
 * Which uploaded files the browser can render as an inline preview before the
 * server has processed them. The library also supports .jxl/.heic/.heif, which
 * browsers cannot decode — those get a format-badge tile instead.
 */
export const PREVIEWABLE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

function extOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot < 0 ? "" : filename.slice(dot).toLowerCase();
}

export function isPreviewable(filename: string): boolean {
  return PREVIEWABLE_EXTENSIONS.has(extOf(filename));
}

/** Uppercased extension without the dot (e.g. "HEIC"); "FILE" when extensionless. */
export function formatBadge(filename: string): string {
  const ext = extOf(filename);
  return ext ? ext.slice(1).toUpperCase() : "FILE";
}
