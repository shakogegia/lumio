import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@lumio/db";
import { SUPPORTED_EXTENSIONS } from "@lumio/shared";
import { CACHE_DIR, TRASH_DIR } from "@/lib/paths";

/**
 * Sum the bytes of every file under `dir` (recursively); 0 if the dir is absent.
 *
 * A directory has no intrinsic "size" — the OS only stores its entries — so the
 * only way to total it is to stat every file. That's inherently O(files) (`du`
 * does the same). We keep it as fast and polite as possible: read the whole tree
 * in one recursive `readdir`, then stat in bounded-concurrency batches so we
 * don't serialize tens of thousands of round-trips, and don't flood the libuv
 * threadpool (which would stall image serving and every other fs-touching route).
 */
export async function dirSize(dir: string): Promise<number> {
  let entries;
  try {
    entries = await readdir(dir, { recursive: true, withFileTypes: true });
  } catch {
    return 0; // directory doesn't exist yet
  }
  const files = entries.filter((e) => e.isFile());
  const BATCH = 64;
  let total = 0;
  for (let i = 0; i < files.length; i += BATCH) {
    const sizes = await Promise.all(
      files.slice(i, i + BATCH).map((e) =>
        stat(path.join(e.parentPath, e.name)).then(
          (s) => s.size,
          () => 0, // vanished between readdir and stat
        ),
      ),
    );
    total += sizes.reduce((sum, n) => sum + n, 0);
  }
  return total;
}

/**
 * Count the supported image files under `dir` (recursively); 0 if absent. This
 * matches what the ingester would index, so it can be compared against the photo
 * count in the DB to surface drift (files not yet indexed, or rows whose files
 * were removed without a reindex). Only needs the directory listing — no per-file
 * stat — so it's much cheaper than `dirSize`.
 */
export async function countImageFiles(dir: string): Promise<number> {
  let entries;
  try {
    entries = await readdir(dir, { recursive: true, withFileTypes: true });
  } catch {
    return 0;
  }
  return entries.filter(
    (e) => e.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(e.name).toLowerCase()),
  ).length;
}

/** Catalog facts that are cheap to read from the DB (indexed count + latest row). */
export async function getCatalogStats(catalogId: string) {
  const [photoCount, latest] = await Promise.all([
    prisma.photo.count({ where: { catalogId } }),
    prisma.photo.findFirst({
      where: { catalogId },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
  ]);

  return {
    photoCount,
    lastIndexedAt: latest ? latest.updatedAt.toISOString() : null,
  };
}

// On-disk byte sizes — measured from the filesystem, the true source of truth for
// actual disk usage (photos can be added/removed and the cache/trash wiped
// out-of-band, so the DB can drift from reality). Each is an O(files) walk, so we
// memoize briefly — navigating to Settings shouldn't re-walk every visit, and an
// informational size tolerates a little staleness — and the page streams them in
// via <Suspense> so the walk never blocks the render.
const STORAGE_SIZE_TTL_MS = 60_000;
type StorageSizes = {
  photosSize: number;
  thumbnailsSize: number;
  displaysSize: number;
  trashSize: number;
};
const storageSizeMemos = new Map<string, { at: number; sizes: StorageSizes }>();

export async function getStorageSizes(catalog: {
  id: string;
  path: string;
}): Promise<StorageSizes> {
  const now = Date.now();
  const memo = storageSizeMemos.get(catalog.id);
  if (memo && now - memo.at < STORAGE_SIZE_TTL_MS) {
    return memo.sizes;
  }
  const [photosSize, thumbnailsSize, displaysSize, trashSize] = await Promise.all([
    dirSize(catalog.path),
    dirSize(path.join(CACHE_DIR, catalog.id, "thumbnails")),
    dirSize(path.join(CACHE_DIR, catalog.id, "displays")),
    dirSize(path.join(TRASH_DIR, catalog.id)),
  ]);
  const sizes = { photosSize, thumbnailsSize, displaysSize, trashSize };
  storageSizeMemos.set(catalog.id, { at: now, sizes });
  return sizes;
}

// Image files actually on disk under catalog.path. Compared against the DB photo
// count on the Settings page to reveal drift. Just a directory listing (no
// stats), but still memoized + streamed so it never blocks the page. Its own
// memo so the cheap count streams in independently of the slower size walk.
const FILE_COUNT_TTL_MS = 60_000;
const fileCountMemos = new Map<string, { at: number; count: number }>();

export async function getPhotoFileCount(catalog: { id: string; path: string }): Promise<number> {
  const now = Date.now();
  const memo = fileCountMemos.get(catalog.id);
  if (memo && now - memo.at < FILE_COUNT_TTL_MS) {
    return memo.count;
  }
  const count = await countImageFiles(catalog.path);
  fileCountMemos.set(catalog.id, { at: now, count });
  return count;
}

/** Drop the memoized filesystem figures so the next read re-walks (manual recalc).
 *  Pass a catalogId to clear only that catalog, or omit to clear all. */
export function invalidateStorageStats(catalogId?: string): void {
  if (catalogId !== undefined) {
    storageSizeMemos.delete(catalogId);
    fileCountMemos.delete(catalogId);
  } else {
    storageSizeMemos.clear();
    fileCountMemos.clear();
  }
}
