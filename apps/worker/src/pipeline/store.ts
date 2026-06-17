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
}

/** Upsert a photo by its unique path, then write its thumbnail to <dir>/<id>.webp. */
export async function storePhoto(
  input: StoreInput,
  deps: StoreDeps,
): Promise<{ id: string }> {
  const { path: relPath, source, processed } = input;

  const data = {
    source,
    takenAt: processed.takenAt,
    sortDate: processed.takenAt ?? new Date(),
    width: processed.width,
    height: processed.height,
    hash: processed.hash,
    exif: processed.exif as object,
  };

  const row = await deps.db.photo.upsert({
    where: { path: relPath },
    create: { path: relPath, ...data },
    update: data,
    select: { id: true },
  });

  await mkdir(deps.thumbnailsDir, { recursive: true });
  await writeFile(path.join(deps.thumbnailsDir, `${row.id}.webp`), processed.thumbnail);

  return { id: row.id };
}
