import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { listCatalogs, prisma } from "@lumio/db";
import { SUPPORTED_EXTENSIONS, hashFile, ingestPath, regenerateRenditions, removePath } from "@lumio/ingest";
import { coercePhotoEdits, errorMessage, hasEdits, wbBaselineOf } from "@lumio/shared";
import { INGEST_CONCURRENCY, displayPath, editedDisplayPath, thumbnailPath } from "./config.js";
import { ingestDepsFor, removeDepsFor } from "./deps.js";
import { timedLine } from "./format.js";
import { log } from "./log.js";
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

/** Recursively list supported image files as paths relative to rootDir. */
async function listImages(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
    .map((e) => path.relative(rootDir, path.join(e.parentPath, e.name)));
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
  catalogId: true,
  path: true,
  fileSize: true,
  fileMtimeMs: true,
  hash: true,
  edits: true,
  asShotTempK: true,
  asShotTint: true,
} as const;

export interface ScanRow {
  id: string;
  catalogId: string;
  path: string;
  fileSize: number;
  fileMtimeMs: number;
  hash: string | null;
  edits: unknown;
  asShotTempK: number | null;
  asShotTint: number | null;
}

async function cachePresent(catalogId: string, id: string, edited: boolean): Promise<boolean> {
  if (!(await fileExists(thumbnailPath(catalogId, id))) || !(await fileExists(displayPath(catalogId, id)))) return false;
  if (edited && !(await fileExists(editedDisplayPath(catalogId, id)))) return false;
  return true;
}

/** Rebuild a missing cache from the stored recipe — no DB write. The recomputed
 *  thumbhash/width/height are intentionally discarded: same source + recipe +
 *  pipeline make them deterministically equal to the values already stored, so
 *  there is nothing to persist (and persisting would needlessly bump updatedAt). */
async function heal(catalog: { id: string; path: string }, row: ScanRow, absPath: string): Promise<void> {
  // Pass the photo's as-shot baseline so the healed edited rendition matches the
  // editor preview + the on-demand /edited bake (identity at the baseline).
  await regenerateRenditions(
    absPath,
    coercePhotoEdits(row.edits),
    row.id,
    ingestDepsFor(catalog),
    wbBaselineOf(row),
  );
}

/**
 * Record the current size + file dates so an unchanged file isn't re-hashed next scan.
 * Uses a raw UPDATE so it does NOT bump `updatedAt` — restamping a file whose
 * pixels never changed must stay invisible to the rendition cache-bust URL,
 * which keys off `updatedAt`. It updates the file-date columns to track the
 * touched file but deliberately leaves `sortDate` untouched — a touch that
 * doesn't change pixels must not reorder the photo.
 */
async function refreshStamp(
  id: string,
  st: { size: number; mtimeMs: number; birthtimeMs: number },
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "Photo"
    SET "fileSize" = ${st.size},
        "fileMtimeMs" = ${st.mtimeMs},
        "fileModifiedAt" = ${new Date(st.mtimeMs)},
        "fileCreatedAt" = ${new Date(st.birthtimeMs)}
    WHERE "id" = ${id}
  `;
}

/**
 * Reconcile one on-disk file against its DB row, mutating `summary`. Shared by
 * the full scan (row supplied from a preloaded map) and the watcher (row fetched
 * per event). Never clobbers edits/sort/renditions for an unchanged file.
 */
export async function reconcileFile(
  catalog: { id: string; path: string },
  relPath: string,
  row: ScanRow | undefined,
  summary: ScanSummary,
): Promise<void> {
  const absPath = path.join(catalog.path, relPath);
  const st = await stat(absPath);
  const recipe = row ? coercePhotoEdits(row.edits) : null;
  const cacheExists = row ? await cachePresent(catalog.id, row.id, hasEdits(recipe)) : false;

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
      await heal(catalog, row!, absPath);
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
    await heal(catalog, row!, absPath);
    summary.healed++;
    return;
  }

  const start = performance.now();
  await ingestPath(relPath, ingestDepsFor(catalog));
  summary.processed++;
  log.info(`processed ${timedLine(relPath, performance.now() - start)}`, { scope: "scan", catalogId: catalog.id });
}

/** Scan one catalog: ingest new/changed images concurrently, skip unchanged, reconcile deletions. */
export async function scanCatalog(
  catalog: { id: string; path: string },
  onProgress?: (done: number, total: number) => void,
): Promise<ScanSummary> {
  const relPaths = await listImages(catalog.path);
  const summary: ScanSummary = {
    processed: 0,
    skipped: 0,
    skippedUnchanged: 0,
    healed: 0,
    restamped: 0,
    removed: 0,
  };

  const existing = await prisma.photo.findMany({ where: { catalogId: catalog.id }, select: SCAN_SELECT });
  const byPath = new Map(existing.map((p) => [p.path, p]));
  let done = 0;

  await runPool(relPaths.length, INGEST_CONCURRENCY, async (i) => {
    const relPath = relPaths[i]!;
    try {
      await reconcileFile(catalog, relPath, byPath.get(relPath), summary);
    } catch (err) {
      summary.skipped++;
      log.warn(`skip ${relPath}: ${errorMessage(err)}`, { scope: "scan", catalogId: catalog.id });
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
      await removePath(row.path, removeDepsFor(catalog));
      summary.removed++;
    } catch (err) {
      log.warn(`remove failed ${row.path}: ${errorMessage(err)}`, { scope: "scan", catalogId: catalog.id });
    }
  });

  return summary;
}

/** Scan all catalogs sequentially and return the summed ScanSummary. */
export async function scanAllCatalogs(
  onProgress?: (done: number, total: number) => void,
): Promise<ScanSummary> {
  const catalogs = await listCatalogs();
  const total: ScanSummary = {
    processed: 0,
    skipped: 0,
    skippedUnchanged: 0,
    healed: 0,
    restamped: 0,
    removed: 0,
  };

  for (const catalog of catalogs) {
    const result = await scanCatalog(catalog, onProgress);
    total.processed += result.processed;
    total.skipped += result.skipped;
    total.skippedUnchanged += result.skippedUnchanged;
    total.healed += result.healed;
    total.restamped += result.restamped;
    total.removed += result.removed;
  }

  return total;
}
