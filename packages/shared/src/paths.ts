/**
 * Path helpers for forward-slash, catalog-relative paths (the form stored in
 * `Photo.path`). Pure string ops — safe to import anywhere (ingest, db, web).
 */

/**
 * Parent directory of a relative path; "" when the path is at the root (no
 * slash). e.g. `parentDir("2024/trip/a.jpg")` → "2024/trip",
 * `parentDir("a.jpg")` → "".
 */
export function parentDir(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}
