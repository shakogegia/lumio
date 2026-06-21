import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { prisma } from "@lumio/db";
import {
  SUPPORTED_EXTENSIONS,
  hashFile,
  ingestPath,
  regenerateRenditions,
  removePath,
} from "@lumio/ingest";
import { coercePhotoEdits } from "@lumio/shared";
import { INGEST_CONCURRENCY, PHOTOS_DIR, displayPath, thumbnailPath } from "./config.js";
import { ingestDeps, removeDeps } from "./deps.js";
import { timedLine } from "./format.js";
import { runPool } from "./pool.js";

export interface ScanSummary {
  processed: number; // new files + genuine re-imports
  skipped: number; // errored files
  skippedUnchanged: number; // content unchanged, nothing to do
  healed: number; // missing cache rebuilt edits-aware
  restamped: number; // timestamp moved but content identical
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
  row: { fileSize: number; fileMtimeMs: number } | undefined,
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

/** Columns the per-file reconcile needs. */
export const SCAN_SELECT = {
  id: true,
  path: true,
  fileSize: true,
  fileMtimeMs: true,
  hash: true,
  edits: true,
} as const;

export interface ScanRow {
  id: string;
  path: string;
  fileSize: number;
  fileMtimeMs: number;
  hash: string | null;
  edits: unknown;
}

async function cachePresent(id: string): Promise<boolean> {
  return (await fileExists(thumbnailPath(id))) && (await fileExists(displayPath(id)));
}

/** Rebuild a missing cache from the stored recipe — no DB write. The recomputed
 *  thumbhash/width/height are intentionally discarded: same source + recipe +
 *  pipeline make them deterministically equal to the values already stored, so
 *  there is nothing to persist (and persisting would needlessly bump updatedAt). */
async function heal(row: ScanRow, absPath: string): Promise<void> {
  await regenerateRenditions(absPath, coercePhotoEdits(row.edits), row.id, ingestDeps);
}

/**
 * Record the current size+mtime so an unchanged file isn't re-hashed next scan.
 * Uses a raw UPDATE so it does NOT bump `updatedAt` — restamping a file whose
 * pixels never changed must stay invisible to the rendition cache-bust URL,
 * which keys off `updatedAt`. It updates the file-date columns to track the
 * touched file but deliberately leaves `sortDate` untouched — a touch that
 * doesn't change pixels must not reorder the photo.
 */
async function refreshStamp(id: string, st: { size: number; mtimeMs: number }): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "Photo"
    SET "fileSize" = ${st.size},
        "fileMtimeMs" = ${st.mtimeMs},
        "fileModifiedAt" = ${new Date(st.mtimeMs)}
    WHERE "id" = ${id}
  `;
}

/**
 * Reconcile one on-disk file against its DB row, mutating `summary`. Shared by
 * the full scan (row supplied from a preloaded map) and the watcher (row fetched
 * per event). Never clobbers edits/sort/renditions for an unchanged file.
 */
export async function reconcileFile(
  relPath: string,
  row: ScanRow | undefined,
  summary: ScanSummary,
): Promise<void> {
  const absPath = path.join(PHOTOS_DIR, relPath);
  const st = await stat(absPath);
  const cacheExists = row ? await cachePresent(row.id) : false;

  let plan = planScan(row, st, cacheExists);
  if (plan === "check-hash") {
    const matches = (await hashFile(absPath)) === row!.hash;
    const after = planAfterHash(matches, cacheExists);
    if (after === "stamp-only") {
      await refreshStamp(row!.id, st);
      summary.restamped++;
      return;
    }
    if (after === "heal") {
      await heal(row!, absPath);
      await refreshStamp(row!.id, st);
      summary.healed++;
      return;
    }
    plan = "new"; // "reimport" → full ingest below (storePhoto clears stale edits)
  }

  if (plan === "skip") {
    summary.skippedUnchanged++;
    return;
  }
  if (plan === "heal") {
    await heal(row!, absPath);
    summary.healed++;
    return;
  }

  const start = performance.now();
  await ingestPath(relPath, ingestDeps);
  summary.processed++;
  console.log(`processed ${timedLine(relPath, performance.now() - start)}`);
}

/** One-shot scan: ingest new/changed images concurrently, skip unchanged, reconcile deletions. */
export async function scanAndIngest(
  onProgress?: (done: number, total: number) => void,
): Promise<ScanSummary> {
  const relPaths = await listImages();
  const summary: ScanSummary = {
    processed: 0,
    skipped: 0,
    skippedUnchanged: 0,
    healed: 0,
    restamped: 0,
    removed: 0,
  };

  const existing = await prisma.photo.findMany({ select: SCAN_SELECT });
  const byPath = new Map(existing.map((p) => [p.path, p]));
  let done = 0;

  await runPool(relPaths.length, INGEST_CONCURRENCY, async (i) => {
    const relPath = relPaths[i]!;
    try {
      await reconcileFile(relPath, byPath.get(relPath), summary);
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
