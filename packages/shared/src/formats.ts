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

/**
 * The last ".xxx" segment of a filename or path, lowercased, without the dot.
 * Returns "" when there is none (no dot, dotfile like ".gitignore", trailing
 * dot, or a dot only in a parent directory). Pure string op (no fs) so the
 * browser, ingest pipeline, and tests share one definition.
 */
export function fileExtension(nameOrPath: string): string {
  const base = nameOrPath.slice(nameOrPath.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return ""; // no dot, or leading-dot dotfile
  return base.slice(dot + 1).toLowerCase();
}
