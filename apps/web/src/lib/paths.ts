import path from "node:path";
import { readdir } from "node:fs/promises";
import {
  catalogCacheDirs as catalogCacheDirsUnder,
  displayPath as displayPathUnder,
  editedDisplayPath as editedDisplayPathUnder,
  thumbnailPath as thumbnailPathUnder,
  type CatalogCacheDirs,
} from "@lumio/ingest";

// Next runs from apps/web; the monorepo root is two levels up.
export const ROOT = path.resolve(process.cwd(), "..", "..");

export const MEDIA_ROOT = path.resolve(process.env.MEDIA_ROOT ?? "/media");
export const CACHE_DIR = path.resolve(ROOT, process.env.CACHE_DIR ?? "./cache");
export const TRASH_DIR = path.resolve(ROOT, process.env.TRASH_DIR ?? "./trash");

export type { CatalogCacheDirs };

export function catalogCacheDirs(catalogId: string): CatalogCacheDirs {
  return catalogCacheDirsUnder(CACHE_DIR, catalogId);
}

export function thumbnailPath(catalogId: string, id: string): string {
  return thumbnailPathUnder(CACHE_DIR, catalogId, id);
}

export function displayPath(catalogId: string, id: string): string {
  return displayPathUnder(CACHE_DIR, catalogId, id);
}

export function editedDisplayPath(catalogId: string, id: string): string {
  return editedDisplayPathUnder(CACHE_DIR, catalogId, id);
}

// The trash mirrors the cache layout under TRASH_DIR. trash-service.ts builds
// its move targets from the injected `trashDir` (for testability, like
// purgeAllPhotos), so the only helper needed here is the one the thumbnail
// route uses to fall back to a trashed photo's rendition.
export function trashThumbnailPath(catalogId: string, id: string): string {
  return path.join(TRASH_DIR, catalogId, "thumbnails", `${id}.webp`);
}

export function originalPath(catalog: { path: string }, relPath: string): string {
  // Guard against path traversal: the resolved path must stay within catalog.path.
  const resolved = path.resolve(catalog.path, relPath);
  if (resolved !== catalog.path && !resolved.startsWith(catalog.path + path.sep)) {
    throw new Error("Path traversal blocked");
  }
  return resolved;
}

export function isInsideMediaRoot(candidate: string): boolean {
  const resolved = path.resolve(candidate);
  return resolved === MEDIA_ROOT || resolved.startsWith(MEDIA_ROOT + path.sep);
}

/** List immediate subdirectories of `absPath`, bounded to MEDIA_ROOT. Throws if outside. */
export async function browseDir(absPath: string): Promise<{
  path: string;
  parent: string | null;
  dirs: { name: string; path: string }[];
}> {
  const target = path.resolve(absPath);
  if (!isInsideMediaRoot(target)) throw new Error("Path is outside the media root");
  const entries = await readdir(target, { withFileTypes: true });
  const dirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, path: path.join(target, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const parent =
    isInsideMediaRoot(path.dirname(target)) && target !== MEDIA_ROOT
      ? path.dirname(target)
      : null;
  return { path: target, parent, dirs };
}
