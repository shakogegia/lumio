import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@lumio/db";
import type { PhotoSource } from "@lumio/shared";
import type { ProcessedPhoto } from "./process.js";

export interface StoreInput {
  path: string; // path relative to PHOTOS_DIR
  source: PhotoSource;
  processed: ProcessedPhoto;
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
  const { path: relPath, source, processed } = input;

  // `source` records how a photo first entered the system (provenance), so it
  // is set on create only. Re-ingestion of the same path — e.g. the filesystem
  // watcher picking up a freshly uploaded file — must NOT overwrite an upload's
  // source back to `filesystem`.
  const data = {
    takenAt: processed.takenAt,
    sortDate: processed.takenAt ?? new Date(),
    width: processed.width,
    height: processed.height,
    hash: processed.hash,
    thumbhash: processed.thumbhash,
    exif: processed.exif as object,
  };

  const row = await deps.db.photo.upsert({
    where: { path: relPath },
    create: { path: relPath, source, ...data },
    update: data,
    select: { id: true },
  });

  await mkdir(deps.thumbnailsDir, { recursive: true });
  await writeFile(path.join(deps.thumbnailsDir, `${row.id}.webp`), processed.thumbnail);

  await mkdir(deps.displaysDir, { recursive: true });
  await writeFile(path.join(deps.displaysDir, `${row.id}.webp`), processed.display);

  return { id: row.id };
}
