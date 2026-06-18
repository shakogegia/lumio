import { prisma } from "@lumio/db";
import type { IngestDeps, RemoveDeps } from "@lumio/ingest";
import { DISPLAYS_DIR, PHOTOS_DIR, THUMBNAILS_DIR } from "./config.js";

export const ingestDeps: IngestDeps = {
  db: prisma,
  photosDir: PHOTOS_DIR,
  thumbnailsDir: THUMBNAILS_DIR,
  displaysDir: DISPLAYS_DIR,
};

export const removeDeps: RemoveDeps = {
  db: prisma,
  thumbnailsDir: THUMBNAILS_DIR,
  displaysDir: DISPLAYS_DIR,
};
