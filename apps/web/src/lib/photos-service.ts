import { rm } from "node:fs/promises";
import path from "node:path";
import { type PrismaClient, prisma, toPhotoDTO } from "@lumio/db";
import type { PhotosPage, PhotosQuery } from "@lumio/shared";
import { CACHE_DIR, PHOTOS_DIR } from "@/lib/paths";

type Db = Pick<PrismaClient, "photo">;

export async function listPhotos(
  params: PhotosQuery,
  db: Db = prisma,
): Promise<PhotosPage> {
  const { limit, cursor } = params;
  const rows = await db.photo.findMany({
    take: limit,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    orderBy: [{ sortDate: "desc" }, { id: "desc" }],
  });

  const nextCursor =
    rows.length === limit ? (rows[rows.length - 1]?.id ?? null) : null;
  return { items: rows.map(toPhotoDTO), nextCursor };
}

export async function getPhoto(id: string, db: Db = prisma) {
  const row = await db.photo.findUnique({ where: { id }, include: { albums: { select: { albumId: true } } } });
  if (!row) return null;
  return { ...toPhotoDTO(row), albumIds: row.albums.map((a) => a.albumId) };
}

export interface PurgeDeps {
  db: Db;
  photosDir: string;
  cacheDir: string;
}

export interface PurgeResult {
  deleted: number;
}

/**
 * Danger zone: delete every photo from the database and the filesystem,
 * including the original files and their cached thumbnails/displays.
 *
 * Files are removed best-effort (missing files are ignored) before the rows
 * are deleted, so a rescan won't re-import originals that survived a wipe.
 */
export async function purgeAllPhotos(
  deps: PurgeDeps = { db: prisma, photosDir: PHOTOS_DIR, cacheDir: CACHE_DIR },
): Promise<PurgeResult> {
  const photos = await deps.db.photo.findMany({ select: { id: true, path: true } });

  await Promise.all(
    photos.flatMap((p) => [
      rm(path.join(deps.photosDir, p.path), { force: true }),
      rm(path.join(deps.cacheDir, "thumbnails", `${p.id}.webp`), { force: true }),
      rm(path.join(deps.cacheDir, "displays", `${p.id}.webp`), { force: true }),
    ]),
  );

  const { count } = await deps.db.photo.deleteMany({});
  return { deleted: count };
}
