import { rm } from "node:fs/promises";
import path from "node:path";
import { type PrismaClient, prisma, toPhotoDTO } from "@lumio/db";
import type { PhotoNeighbors, PhotosPage, PhotosQuery, PhotoStripItem } from "@lumio/shared";
import { albumPhotoWhere } from "@/lib/albums-service";
import { CACHE_DIR, PHOTOS_DIR } from "@/lib/paths";
import { PHOTO_ORDER } from "@/lib/photo-order";

type Db = Pick<PrismaClient, "photo">;

type NeighborDb = Pick<PrismaClient, "photo" | "album">;

export async function listPhotos(
  params: PhotosQuery,
  db: Db = prisma,
): Promise<PhotosPage> {
  const { limit, cursor } = params;
  const rows = await db.photo.findMany({
    take: limit,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    orderBy: PHOTO_ORDER,
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

/**
 * Neighbors of `current` within a navigation scope, for the detail view's arrows
 * and film strip. `albumId` null = whole library; otherwise the album's photos
 * (regular or smart). Uses keyset cursoring on the current id over PHOTO_ORDER:
 * a forward page (next) and a backward page (prev, negative take). Both come back
 * in PHOTO_ORDER, so `before` ends with the nearest-prev and `strip` reads
 * left-to-right as the grid does. Selects only id+path to keep the window cheap.
 */
export async function getPhotoNeighbors(
  current: PhotoStripItem,
  albumId: string | null,
  window = 25,
  db: NeighborDb = prisma,
): Promise<PhotoNeighbors> {
  const where = albumId ? await albumPhotoWhere(albumId, db) : {};
  if (where === null) {
    // Album no longer exists — degrade to no navigation rather than throwing.
    return { prevId: null, nextId: null, strip: [current] };
  }
  const select = { id: true, path: true } as const;
  const [before, after] = await Promise.all([
    db.photo.findMany({
      where,
      cursor: { id: current.id },
      skip: 1,
      take: -window,
      orderBy: PHOTO_ORDER,
      select,
    }),
    db.photo.findMany({
      where,
      cursor: { id: current.id },
      skip: 1,
      take: window,
      orderBy: PHOTO_ORDER,
      select,
    }),
  ]);
  return {
    prevId: before.at(-1)?.id ?? null,
    nextId: after[0]?.id ?? null,
    strip: [...before, current, ...after],
  };
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
