import { readdir } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@lumio/db";
import { SUPPORTED_EXTENSIONS, ingestPath, removePath } from "@lumio/ingest";
import { PHOTOS_DIR } from "./config.js";
import { ingestDeps, removeDeps } from "./deps.js";

export interface ScanSummary {
  processed: number;
  skipped: number;
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

/** One-shot scan: ingest every supported image, then reconcile deletions. */
export async function scanAndIngest(): Promise<ScanSummary> {
  const relPaths = await listImages();
  const summary: ScanSummary = { processed: 0, skipped: 0, removed: 0 };

  for (const relPath of relPaths) {
    try {
      await ingestPath(relPath, ingestDeps);
      summary.processed++;
    } catch (err) {
      summary.skipped++;
      console.warn(`skip ${relPath}: ${(err as Error).message}`);
    }
  }

  const existing = await prisma.photo.findMany({ select: { id: true, path: true } });
  const onDisk = new Set(relPaths);
  const toDelete = new Set(reconcileDeletions(existing.map((p) => p.path), onDisk));

  for (const row of existing.filter((p) => toDelete.has(p.path))) {
    await removePath(row.path, removeDeps);
    summary.removed++;
  }

  return summary;
}
