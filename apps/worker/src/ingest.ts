import { rm } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@lumio/db";
import { prisma } from "@lumio/db";
import { PhotoSource } from "@lumio/shared";
import { DISPLAYS_DIR, PHOTOS_DIR, THUMBNAILS_DIR } from "./config.js";
import { processImage } from "./pipeline/process.js";
import { storePhoto } from "./pipeline/store.js";

export interface IngestDeps {
  db: Pick<PrismaClient, "photo">;
  thumbnailsDir: string;
  displaysDir: string;
  photosDir: string;
}

export async function ingestPath(
  relPath: string,
  deps: IngestDeps = {
    db: prisma,
    thumbnailsDir: THUMBNAILS_DIR,
    displaysDir: DISPLAYS_DIR,
    photosDir: PHOTOS_DIR,
  },
): Promise<void> {
  const processed = await processImage(path.join(deps.photosDir, relPath));
  await storePhoto(
    { path: relPath, source: PhotoSource.filesystem, processed },
    { db: deps.db, thumbnailsDir: deps.thumbnailsDir, displaysDir: deps.displaysDir },
  );
}

export interface RemoveDeps {
  db: Pick<PrismaClient, "photo">;
  thumbnailsDir: string;
  displaysDir: string;
}

export async function removePath(
  relPath: string,
  deps: RemoveDeps = { db: prisma, thumbnailsDir: THUMBNAILS_DIR, displaysDir: DISPLAYS_DIR },
): Promise<void> {
  const found = await deps.db.photo.findUnique({ where: { path: relPath }, select: { id: true } });
  if (!found) return;
  await deps.db.photo.delete({ where: { id: found.id } });
  await rm(path.join(deps.thumbnailsDir, `${found.id}.webp`), { force: true });
  await rm(path.join(deps.displaysDir, `${found.id}.webp`), { force: true });
}
