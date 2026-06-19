/**
 * Build a download filename for an entry inside a zip. Entries are flattened to
 * their basename; collisions across source folders are de-duplicated with a
 * numeric suffix inserted before the extension (`a.jpg`, `a (2).jpg`, …).
 * Mutates `used` with the chosen name.
 */
export function dedupeEntryName(basename: string, used: Set<string>): string {
  if (!used.has(basename)) {
    used.add(basename);
    return basename;
  }
  const dot = basename.lastIndexOf(".");
  const stem = dot > 0 ? basename.slice(0, dot) : basename;
  const ext = dot > 0 ? basename.slice(dot) : "";
  let n = 2;
  let candidate = `${stem} (${n})${ext}`;
  while (used.has(candidate)) {
    n += 1;
    candidate = `${stem} (${n})${ext}`;
  }
  used.add(candidate);
  return candidate;
}

/**
 * Turn an album name into a safe zip filename (no path separators or reserved
 * characters), falling back to "album" when the result is empty. Does not
 * include the ".zip" extension — the caller appends it.
 */
export function sanitizeZipName(name: string): string {
  const cleaned = name
    .replace(/[/\\]/g, "-")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f<>:"|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return cleaned || "album";
}

/**
 * Build a `Content-Disposition: attachment` header value with an ASCII filename
 * fallback plus a UTF-8 `filename*` parameter (RFC 5987 / 6266), so unicode
 * names survive in modern browsers while older clients still get a usable name.
 */
export function attachmentDisposition(filename: string): string {
  // eslint-disable-next-line no-control-regex
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
