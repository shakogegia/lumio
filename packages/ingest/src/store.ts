import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Prisma, type PrismaClient } from "@lumio/db";
import type { PhotoSource } from "@lumio/shared";
import type { ProcessedPhoto } from "./process.js";

export interface StoreInput {
  catalogId: string;
  path: string; // path relative to the catalog root
  source: PhotoSource;
  processed: ProcessedPhoto;
  fileSize: number; // bytes, from fs.stat
  fileMtimeMs: number; // mtimeMs, from fs.stat
  fileBirthtimeMs: number; // birthtimeMs, from fs.stat
}

export interface StoreDeps {
  db: Pick<PrismaClient, "photo">;
  thumbnailsDir: string;
  displaysDir: string;
}

/**
 * Upsert a photo by its unique path, then write its thumbnail and display
 * rendition to <thumbnailsDir>/<id>.webp and <displaysDir>/<id>.webp.
 */
export async function storePhoto(
  input: StoreInput,
  deps: StoreDeps,
): Promise<{ id: string }> {
  const { catalogId, path: relPath, source, processed, fileSize, fileMtimeMs, fileBirthtimeMs } = input;

  // Readable mirrors of the raw stat stamps. mtime and birthtime are both
  // POSIX-provided numbers, so these are always valid Dates.
  const fileModifiedAt = new Date(fileMtimeMs);
  const fileCreatedAt = new Date(fileBirthtimeMs);

  // `source` records how a photo first entered the system (provenance), so it
  // is set on create only. Re-ingestion of the same path — e.g. the filesystem
  // watcher picking up a freshly uploaded file — must NOT overwrite an upload's
  // source back to `filesystem`.
  const data = {
    takenAt: processed.takenAt,
    // Chronology for the "Date taken" sort: the EXIF capture date when present,
    // otherwise the EARLIEST of the file's created/modified dates — the best
    // lower-bound proxy for when the photo actually happened (a download keeps
    // its server mtime; an edited screenshot keeps its birthtime). Both file
    // dates are always set, so there is no import-time floor. A genuine
    // re-import re-derives this; the content-unchanged restamp path leaves
    // `sortDate` alone (see scan.ts).
    sortDate:
      processed.takenAt ?? (fileCreatedAt < fileModifiedAt ? fileCreatedAt : fileModifiedAt),
    width: processed.width,
    height: processed.height,
    hash: processed.hash,
    thumbhash: processed.thumbhash,
    exif: processed.exif as object,
    fileSize,
    fileMtimeMs,
    fileModifiedAt,
    fileCreatedAt,
  };

  const row = await deps.db.photo.upsert({
    where: { catalogId_path: { catalogId, path: relPath } },
    create: { catalogId, path: relPath, source, ...data },
    // A re-import means the file's bytes changed (the scan/watch only calls this
    // on a genuine hash change); the old edit recipe no longer applies to the
    // new pixels, so clear it. `create` leaves edits at its column default.
    update: { ...data, edits: Prisma.JsonNull },
    select: { id: true },
  });

  await mkdir(deps.thumbnailsDir, { recursive: true });
  await writeFile(path.join(deps.thumbnailsDir, `${row.id}.webp`), processed.thumbnail);

  await mkdir(deps.displaysDir, { recursive: true });
  await writeFile(path.join(deps.displaysDir, `${row.id}.webp`), processed.display);

  return { id: row.id };
}
