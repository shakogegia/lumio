import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@lumio/db";
import { CACHE_DIR, PHOTOS_DIR } from "@/lib/paths";

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
 * Catalog counts + photo storage. All cheap, indexed DB queries — no filesystem
 * walk. Photo storage is `SUM(fileSize)` (recorded per photo at ingest), which
 * is instant and stays consistent with the photo count (also from the DB).
 */
export async function getCatalogStats() {
  const [photoCount, albumCount, latest, sizeAgg] = await Promise.all([
    prisma.photo.count(),
    prisma.album.count(),
    prisma.photo.findFirst({
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
    prisma.photo.aggregate({ _sum: { fileSize: true } }),
  ]);

  return {
    photosDir: PHOTOS_DIR,
    photoCount,
    albumCount,
    photosSize: sizeAgg._sum.fileSize ?? 0,
    lastIndexedAt: latest ? latest.updatedAt.toISOString() : null,
  };
}

// Cache size is the one figure that must hit the filesystem: the cache is
// regenerable and can be wiped outside the app, so the FS — not the DB — is the
// source of truth. Memoize briefly so navigating to Settings doesn't re-walk
// tens of thousands of files every visit; an informational size tolerates a
// little staleness. The Settings page streams this in via <Suspense> so the walk
// never blocks the page render.
const CACHE_SIZE_TTL_MS = 60_000;
let cacheSizeMemo: { at: number; thumbnailsSize: number; displaysSize: number } | null = null;

export async function getCacheSizes(): Promise<{
  thumbnailsSize: number;
  displaysSize: number;
}> {
  const now = Date.now();
  if (cacheSizeMemo && now - cacheSizeMemo.at < CACHE_SIZE_TTL_MS) {
    const { thumbnailsSize, displaysSize } = cacheSizeMemo;
    return { thumbnailsSize, displaysSize };
  }
  const [thumbnailsSize, displaysSize] = await Promise.all([
    dirSize(path.join(CACHE_DIR, "thumbnails")),
    dirSize(path.join(CACHE_DIR, "displays")),
  ]);
  cacheSizeMemo = { at: now, thumbnailsSize, displaysSize };
  return { thumbnailsSize, displaysSize };
}
