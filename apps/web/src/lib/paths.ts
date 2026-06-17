import path from "node:path";

// Next runs from apps/web; the monorepo root is two levels up.
export const ROOT = path.resolve(process.cwd(), "..", "..");

export const PHOTOS_DIR = path.resolve(ROOT, process.env.PHOTOS_DIR ?? "./photos");
export const CACHE_DIR = path.resolve(ROOT, process.env.CACHE_DIR ?? "./cache");

export function thumbnailPath(id: string): string {
  return path.join(CACHE_DIR, "thumbnails", `${id}.webp`);
}

export function originalPath(relPath: string): string {
  // Guard against path traversal: the resolved path must stay within PHOTOS_DIR.
  const resolved = path.resolve(PHOTOS_DIR, relPath);
  if (!resolved.startsWith(PHOTOS_DIR + path.sep)) {
    throw new Error("Path traversal blocked");
  }
  return resolved;
}
