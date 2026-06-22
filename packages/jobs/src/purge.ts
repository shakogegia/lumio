import { rm } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@lumio/db";

export interface PurgeAllDeps {
  db: Pick<PrismaClient, "photo">;
  catalogId: string;
  photosDir: string;
  cacheDir: string;
}

/**
 * Danger zone: delete every photo from a catalog from the database and the filesystem,
 * including originals and cached thumbnails/displays. Files are removed
 * best-effort (missing files ignored) before the rows, so a rescan won't
 * re-import originals that survived a wipe.
 */
export async function purgeAllPhotos(deps: PurgeAllDeps): Promise<{ deleted: number }> {
  const photos = await deps.db.photo.findMany({ where: { catalogId: deps.catalogId }, select: { id: true, path: true } });
  await Promise.all(
    photos.flatMap((p) => [
      rm(path.join(deps.photosDir, p.path), { force: true }),
      rm(path.join(deps.cacheDir, "thumbnails", `${p.id}.webp`), { force: true }),
      rm(path.join(deps.cacheDir, "displays", `${p.id}.webp`), { force: true }),
    ]),
  );
  const { count } = await deps.db.photo.deleteMany({ where: { catalogId: deps.catalogId } });
  return { deleted: count };
}

export interface PurgeTrashDeps {
  db: Pick<PrismaClient, "trashedPhoto">;
  catalogId: string;
  trashDir: string;
}

/** Permanently remove trashed photos (all when `ids` is undefined) + their files. */
export async function purgeTrash(
  ids: string[] | undefined,
  deps: PurgeTrashDeps,
): Promise<{ deleted: number }> {
  const where = { catalogId: deps.catalogId, ...(ids ? { id: { in: ids } } : {}) };
  const rows = await deps.db.trashedPhoto.findMany({
    where,
    select: { id: true, originalPath: true },
  });
  await Promise.all(
    rows.flatMap((r) => {
      const ext = path.extname(r.originalPath);
      return [
        rm(path.join(deps.trashDir, "originals", `${r.id}${ext}`), { force: true }),
        rm(path.join(deps.trashDir, "thumbnails", `${r.id}.webp`), { force: true }),
        rm(path.join(deps.trashDir, "displays", `${r.id}.webp`), { force: true }),
      ];
    }),
  );
  const { count } = await deps.db.trashedPhoto.deleteMany({ where });
  return { deleted: count };
}
