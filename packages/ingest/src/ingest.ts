import { rm, stat } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@lumio/db";
import { PhotoSource } from "@lumio/shared";
import { processImage } from "./process.js";
import { storePhoto } from "./store.js";

export interface IngestDeps {
  db: Pick<PrismaClient, "photo">;
  catalogId: string;
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
  const absPath = path.join(deps.photosDir, relPath);
  const st = await stat(absPath);
  const processed = await processImage(absPath);
  return storePhoto(
    {
      catalogId: deps.catalogId,
      path: relPath,
      source,
      processed,
      fileSize: st.size,
      fileMtimeMs: st.mtimeMs,
      fileBirthtimeMs: st.birthtimeMs,
    },
    { db: deps.db, thumbnailsDir: deps.thumbnailsDir, displaysDir: deps.displaysDir },
  );
}

export interface RemoveDeps {
  db: Pick<PrismaClient, "photo">;
  catalogId: string;
  thumbnailsDir: string;
  displaysDir: string;
  editedDisplaysDir: string;
}

export async function removePath(relPath: string, deps: RemoveDeps): Promise<void> {
  const found = await deps.db.photo.findUnique({
    where: { catalogId_path: { catalogId: deps.catalogId, path: relPath } },
    select: { id: true },
  });
  if (!found) return;
  await deps.db.photo.delete({ where: { id: found.id } });
  await rm(path.join(deps.thumbnailsDir, `${found.id}.webp`), { force: true });
  await rm(path.join(deps.displaysDir, `${found.id}.webp`), { force: true });
  await rm(path.join(deps.editedDisplaysDir, `${found.id}.webp`), { force: true });
}
