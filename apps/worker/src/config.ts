import path from "node:path";
import { fileURLToPath } from "node:url";

// This file lives at apps/worker/src/config.ts → repo root is three levels up.
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

function resolveFromRoot(value: string | undefined, fallback: string): string {
  return path.resolve(REPO_ROOT, value ?? fallback);
}

/** Absolute path to the source-of-truth originals directory. */
export const PHOTOS_DIR = resolveFromRoot(process.env.PHOTOS_DIR, "./photos");

/** Absolute path to the regenerable cache root. */
export const CACHE_DIR = resolveFromRoot(process.env.CACHE_DIR, "./cache");

/** Build-time thumbnail max edge (px). Changing this requires regenerating the cache. */
export const THUMBNAIL_MAX = 400;

export const THUMBNAILS_DIR = path.join(CACHE_DIR, "thumbnails");

/** Absolute path of a photo's thumbnail file. */
export function thumbnailPath(id: string): string {
  return path.join(THUMBNAILS_DIR, `${id}.webp`);
}

/** Image extensions the scanner ingests. */
export const SUPPORTED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".jxl", ".heic", ".heif"]);
