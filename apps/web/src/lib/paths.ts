import path from "node:path";

// Next runs from apps/web; the monorepo root is two levels up.
export const ROOT = path.resolve(process.cwd(), "..", "..");

export const PHOTOS_DIR = path.resolve(ROOT, process.env.PHOTOS_DIR ?? "./photos");
export const CACHE_DIR = path.resolve(ROOT, process.env.CACHE_DIR ?? "./cache");
export const TRASH_DIR = path.resolve(ROOT, process.env.TRASH_DIR ?? "./trash");

export function thumbnailPath(id: string): string {
  return path.join(CACHE_DIR, "thumbnails", `${id}.webp`);
}

export function displayPath(id: string): string {
  return path.join(CACHE_DIR, "displays", `${id}.webp`);
}

export function trashOriginalPath(id: string, ext: string): string {
  return path.join(TRASH_DIR, "originals", `${id}${ext}`);
}

export function trashThumbnailPath(id: string): string {
  return path.join(TRASH_DIR, "thumbnails", `${id}.webp`);
}

export function trashDisplayPath(id: string): string {
  return path.join(TRASH_DIR, "displays", `${id}.webp`);
}

export function originalPath(relPath: string): string {
  // Guard against path traversal: the resolved path must stay within PHOTOS_DIR.
  const resolved = path.resolve(PHOTOS_DIR, relPath);
  if (!resolved.startsWith(PHOTOS_DIR + path.sep)) {
    throw new Error("Path traversal blocked");
  }
  return resolved;
}
