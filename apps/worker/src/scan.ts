import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@lumio/db";
import { SUPPORTED_EXTENSIONS, ingestPath, removePath } from "@lumio/ingest";
import { INGEST_CONCURRENCY, PHOTOS_DIR, displayPath, thumbnailPath } from "./config.js";
import { ingestDeps, removeDeps } from "./deps.js";
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

/**
 * Pure decision: is the on-disk file already ingested and unchanged? True only
 * when a row exists, its recorded size+mtime match the current stat, and the
 * rendered cache is present (so a wiped cache forces regeneration).
 */
export function isUnchanged(
  row: { fileSize: number | null; fileMtimeMs: number | null } | undefined,
  st: { size: number; mtimeMs: number },
  cacheExists: boolean,
): boolean {
  return (
    !!row &&
    row.fileSize === st.size &&
    row.fileMtimeMs === st.mtimeMs &&
    cacheExists
  );
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
export async function scanAndIngest(): Promise<ScanSummary> {
  const relPaths = await listImages();
  const summary: ScanSummary = { processed: 0, skipped: 0, skippedUnchanged: 0, removed: 0 };

  const existing = await prisma.photo.findMany({
    select: { id: true, path: true, fileSize: true, fileMtimeMs: true },
  });
  const byPath = new Map(existing.map((p) => [p.path, p]));

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
      await ingestPath(relPath, ingestDeps);
      summary.processed++;
    } catch (err) {
      summary.skipped++;
      console.warn(`skip ${relPath}: ${(err as Error).message}`);
    }
  });

  const onDisk = new Set(relPaths);
  const toDelete = new Set(reconcileDeletions(existing.map((p) => p.path), onDisk));
  const deleteRows = existing.filter((p) => toDelete.has(p.path));
  await runPool(deleteRows.length, INGEST_CONCURRENCY, async (i) => {
    await removePath(deleteRows[i]!.path, removeDeps);
    summary.removed++;
  });

  return summary;
}
