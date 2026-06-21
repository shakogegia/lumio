import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { prisma } from "@lumio/db";
import { SUPPORTED_EXTENSIONS, ingestPath, removePath } from "@lumio/ingest";
import { INGEST_CONCURRENCY, PHOTOS_DIR, displayPath, thumbnailPath } from "./config.js";
import { ingestDeps, removeDeps } from "./deps.js";
import { timedLine } from "./format.js";
import { runPool } from "./pool.js";

export interface ScanSummary {
  processed: number;
  skipped: number;
  skippedUnchanged: number;
  removed: number;
}

/** Pure decision: which DB paths are no longer on disk. */
export function reconcileDeletions(dbPaths: string[], onDisk: Set<string>): string[] {
  return dbPaths.filter((p) => !onDisk.has(p));
}

/** Recursively list supported image files as paths relative to PHOTOS_DIR. */
async function listImages(): Promise<string[]> {
  const entries = await readdir(PHOTOS_DIR, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
    .map((e) => path.relative(PHOTOS_DIR, path.join(e.parentPath, e.name)));
}

export type ScanPlan = "new" | "skip" | "heal" | "check-hash";

/**
 * First decision, from stat + cache presence alone (no file read):
 *  - no row            → "new" (ingest a brand-new file)
 *  - stamp matches      → "skip" (cache present) or "heal" (cache missing)
 *  - stamp differs      → "check-hash" (read the bytes to tell a real change
 *    from a backup/sync that only touched the timestamp)
 */
export function planScan(
  row: { fileSize: number | null; fileMtimeMs: number | null } | undefined,
  st: { size: number; mtimeMs: number },
  cacheExists: boolean,
): ScanPlan {
  if (!row) return "new";
  const stampMatches = row.fileSize === st.size && row.fileMtimeMs === st.mtimeMs;
  if (stampMatches) return cacheExists ? "skip" : "heal";
  return "check-hash";
}

export type HashPlan = "stamp-only" | "heal" | "reimport";

/**
 * Second decision, once the content hash is known. A changed hash is a genuine
 * pixel replacement → re-import. An unchanged hash means only the timestamp
 * moved → refresh the stamp (and heal the cache if it is missing).
 */
export function planAfterHash(hashMatches: boolean, cacheExists: boolean): HashPlan {
  if (!hashMatches) return "reimport";
  return cacheExists ? "stamp-only" : "heal";
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** One-shot scan: ingest new/changed images concurrently, skip unchanged, reconcile deletions. */
export async function scanAndIngest(
  onProgress?: (done: number, total: number) => void,
): Promise<ScanSummary> {
  const relPaths = await listImages();
  const summary: ScanSummary = { processed: 0, skipped: 0, skippedUnchanged: 0, removed: 0 };

  const existing = await prisma.photo.findMany({
    select: { id: true, path: true, fileSize: true, fileMtimeMs: true },
  });
  const byPath = new Map(existing.map((p) => [p.path, p]));
  let done = 0;

  await runPool(relPaths.length, INGEST_CONCURRENCY, async (i) => {
    const relPath = relPaths[i]!;
    try {
      const st = await stat(path.join(PHOTOS_DIR, relPath));
      const row = byPath.get(relPath);
      let cacheExists = false;
      if (row) {
        cacheExists =
          (await fileExists(thumbnailPath(row.id))) &&
          (await fileExists(displayPath(row.id)));
      }
      if (isUnchanged(row, st, cacheExists)) {
        summary.skippedUnchanged++;
        return;
      }
      const start = performance.now();
      await ingestPath(relPath, ingestDeps);
      summary.processed++;
      console.log(`processed ${timedLine(relPath, performance.now() - start)}`);
    } catch (err) {
      summary.skipped++;
      console.warn(`skip ${relPath}: ${(err as Error).message}`);
    } finally {
      onProgress?.(++done, relPaths.length);
    }
  });

  const onDisk = new Set(relPaths);
  const toDelete = new Set(reconcileDeletions(existing.map((p) => p.path), onDisk));
  const deleteRows = existing.filter((p) => toDelete.has(p.path));
  await runPool(deleteRows.length, INGEST_CONCURRENCY, async (i) => {
    const row = deleteRows[i]!;
    try {
      await removePath(row.path, removeDeps);
      summary.removed++;
    } catch (err) {
      console.warn(`remove failed ${row.path}: ${(err as Error).message}`);
    }
  });

  return summary;
}
