import { rm } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@lumio/db";
import { PhotoSource } from "@lumio/shared";
import { processImage } from "./process.js";
import { storePhoto } from "./store.js";

export interface IngestDeps {
  db: Pick<PrismaClient, "photo">;
  thumbnailsDir: string;
  displaysDir: string;
  photosDir: string;
}

/** Process the file at `<photosDir>/<relPath>` and upsert it. Returns the photo id. */
export async function ingestPath(
  relPath: string,
  deps: IngestDeps,
  source: PhotoSource = PhotoSource.filesystem,
): Promise<{ id: string }> {
  const processed = await processImage(path.join(deps.photosDir, relPath));
  return storePhoto(
    { path: relPath, source, processed, fileSize: 0, fileMtimeMs: 0 },
    { db: deps.db, thumbnailsDir: deps.thumbnailsDir, displaysDir: deps.displaysDir },
  );
}

export interface RemoveDeps {
  db: Pick<PrismaClient, "photo">;
  thumbnailsDir: string;
  displaysDir: string;
}

export async function removePath(relPath: string, deps: RemoveDeps): Promise<void> {
  const found = await deps.db.photo.findUnique({ where: { path: relPath }, select: { id: true } });
  if (!found) return;
  await deps.db.photo.delete({ where: { id: found.id } });
  await rm(path.join(deps.thumbnailsDir, `${found.id}.webp`), { force: true });
  await rm(path.join(deps.displaysDir, `${found.id}.webp`), { force: true });
}
