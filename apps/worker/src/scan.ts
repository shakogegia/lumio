import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@lumio/db";
import { PhotoSource } from "@lumio/shared";
import {
  PHOTOS_DIR,
  SUPPORTED_EXTENSIONS,
  THUMBNAILS_DIR,
  thumbnailPath,
} from "./config.js";
import { processImage } from "./pipeline/process.js";
import { storePhoto } from "./pipeline/store.js";

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

/** One-shot scan: ingest every supported image, then reconcile deletions. */
export async function scanAndIngest(): Promise<ScanSummary> {
  const relPaths = await listImages();
  const summary: ScanSummary = { processed: 0, skipped: 0, removed: 0 };

  for (const relPath of relPaths) {
    try {
      const processed = await processImage(path.join(PHOTOS_DIR, relPath));
      await storePhoto(
        { path: relPath, source: PhotoSource.filesystem, processed },
        { db: prisma, thumbnailsDir: THUMBNAILS_DIR },
      );
      summary.processed++;
    } catch (err) {
      summary.skipped++;
      console.warn(`skip ${relPath}: ${(err as Error).message}`);
    }
  }

  const existing = await prisma.photo.findMany({ select: { id: true, path: true } });
  const onDisk = new Set(relPaths);
  const toDelete = reconcileDeletions(existing.map((p) => p.path), onDisk);
  const idsToDelete = existing.filter((p) => toDelete.includes(p.path)).map((p) => p.id);

  for (const id of idsToDelete) {
    await prisma.photo.delete({ where: { id } });
    await rm(thumbnailPath(id), { force: true });
    summary.removed++;
  }

  return summary;
}
