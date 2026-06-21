import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Prisma, type PrismaClient } from "@lumio/db";
import type { PhotoSource } from "@lumio/shared";
import type { ProcessedPhoto } from "./process.js";

export interface StoreInput {
  path: string; // path relative to PHOTOS_DIR
  source: PhotoSource;
  processed: ProcessedPhoto;
  fileSize: number; // bytes, from fs.stat
  fileMtimeMs: number; // mtimeMs, from fs.stat
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
  const { path: relPath, source, processed, fileSize, fileMtimeMs } = input;

  // The file's modified date, as a readable mirror of the raw `fileMtimeMs`
  // fingerprint. mtime is POSIX-guaranteed, so this is always a valid Date.
  const fileModifiedAt = new Date(fileMtimeMs);

  // `source` records how a photo first entered the system (provenance), so it
  // is set on create only. Re-ingestion of the same path — e.g. the filesystem
  // watcher picking up a freshly uploaded file — must NOT overwrite an upload's
  // source back to `filesystem`.
  const data = {
    takenAt: processed.takenAt,
    // Chronology for the "taken" sorts: the EXIF capture date when present,
    // otherwise the file's modified date. fileModifiedAt is always set, so there
    // is no import-time floor (a genuine re-import re-derives this from the new
    // file; the content-unchanged restamp path leaves it alone — see scan.ts).
    sortDate: processed.takenAt ?? fileModifiedAt,
    width: processed.width,
    height: processed.height,
    hash: processed.hash,
    thumbhash: processed.thumbhash,
    exif: processed.exif as object,
    fileSize,
    fileMtimeMs,
    fileModifiedAt,
  };

  const row = await deps.db.photo.upsert({
    where: { path: relPath },
    create: { path: relPath, source, ...data },
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
