/**
 * Visual representation of an upload row that has no server thumbnail yet
 * (queued / uploading / failed). Decoding the original file in the browser to
 * preview it is far too memory-heavy for large batches (full-res bitmaps), so
 * pending rows show a small format badge instead; once a row is ingested it
 * renders the server-generated thumbnail (`/api/thumbnails/<id>`).
 */

function extOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot < 0 ? "" : filename.slice(dot).toLowerCase();
}

/** Uppercased extension without the dot (e.g. "HEIC"); "FILE" when extensionless. */
export function formatBadge(filename: string): string {
  const ext = extOf(filename);
  return ext ? ext.slice(1).toUpperCase() : "FILE";
}
