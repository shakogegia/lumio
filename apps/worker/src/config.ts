import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  catalogCacheDirs as catalogCacheDirsUnder,
  displayPath as displayPathUnder,
  editedDisplayPath as editedDisplayPathUnder,
  thumbnailPath as thumbnailPathUnder,
  type CatalogCacheDirs,
} from "@lumio/ingest";

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

/** Absolute path to the regenerable cache root. */
export const CACHE_DIR = resolveFromRoot(process.env.CACHE_DIR, "./cache");

/** Absolute path to the trash root (mirrors the cache layout). */
export const TRASH_DIR = resolveFromRoot(process.env.TRASH_DIR, "./trash");

/**
 * Resolve how many images to process in parallel. An explicit positive
 * `INGEST_CONCURRENCY` wins; otherwise default to HALF the logical cores so a
 * bulk import leaves CPU headroom for the co-located web app + Postgres (worker,
 * web, and DB share one box in the Docker deploy — pegging every core makes the
 * app unresponsive for the whole import). Always >= 1. The worker also pins
 * `sharp.concurrency(1)` so total CPU ≈ this number, not this × cores.
 */
export function resolveConcurrency(envValue: string | undefined, cores: number): number {
  const explicit = Number(envValue);
  if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
  return Math.max(1, Math.floor(cores / 2));
}

/**
 * Max images processed in parallel during a scan (default: half the logical
 * cores). The entry launchers also size UV_THREADPOOL_SIZE to this value —
 * Sharp's decode/encode runs on the libuv threadpool, so without that the pool
 * plateaus at ~4 regardless of cores.
 */
export const INGEST_CONCURRENCY = resolveConcurrency(
  process.env.INGEST_CONCURRENCY,
  os.cpus().length,
);

export type { CatalogCacheDirs };

/** Per-catalog cache directory paths nested under the shared CACHE_DIR. */
export function catalogCacheDirs(catalogId: string): CatalogCacheDirs {
  return catalogCacheDirsUnder(CACHE_DIR, catalogId);
}

/** Absolute path of a photo's thumbnail file within a catalog's cache. */
export function thumbnailPath(catalogId: string, id: string): string {
  return thumbnailPathUnder(CACHE_DIR, catalogId, id);
}

/** Absolute path of a photo's display rendition within a catalog's cache. */
export function displayPath(catalogId: string, id: string): string {
  return displayPathUnder(CACHE_DIR, catalogId, id);
}

/** Absolute path of a photo's edited display rendition within a catalog's cache. */
export function editedDisplayPath(catalogId: string, id: string): string {
  return editedDisplayPathUnder(CACHE_DIR, catalogId, id);
}
