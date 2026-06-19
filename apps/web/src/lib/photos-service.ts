import { rm } from "node:fs/promises";
import path from "node:path";
import { type Prisma, type PrismaClient, prisma, toPhotoDTO } from "@lumio/db";
import type {
  ColorLabel,
  PhotoNeighbors,
  PhotoSort,
  PhotosPage,
  PhotosQuery,
  PhotoStripItem,
} from "@lumio/shared";
import { albumPhotoWhere } from "@/lib/albums-service";
import { CACHE_DIR, PHOTOS_DIR } from "@/lib/paths";
import { PHOTO_ORDER, photoOrderBy } from "@/lib/photo-order";

type Db = Pick<PrismaClient, "photo">;

type NeighborDb = Pick<PrismaClient, "photo" | "album">;

export async function listPhotos(
  params: PhotosQuery,
  db: Db = prisma,
): Promise<PhotosPage> {
  const { limit, cursor, sort } = params;
  const rows = await db.photo.findMany({
    take: limit,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    orderBy: photoOrderBy(sort),
  });

  const nextCursor =
    rows.length === limit ? (rows[rows.length - 1]?.id ?? null) : null;
  return { items: rows.map(toPhotoDTO), nextCursor };
}

/** Minimal {id, path} for a set of photo ids, in canonical order, for zipping. */
export async function listPhotosForDownload(
  ids: string[],
  db: Db = prisma,
): Promise<{ id: string; path: string }[]> {
  return db.photo.findMany({
    where: { id: { in: ids } },
    orderBy: PHOTO_ORDER,
    select: { id: true, path: true },
  });
}

/**
 * Set (or clear, with `null`) the color label on a batch of photos.
 * Returns the number of rows updated.
 */
export async function setPhotoColorLabel(
  photoIds: string[],
  label: ColorLabel | null,
  db: Db = prisma,
): Promise<number> {
  const { count } = await db.photo.updateMany({
    where: { id: { in: photoIds } },
    data: { colorLabel: label },
  });
  return count;
}

export async function getPhoto(id: string, db: Db = prisma) {
  const row = await db.photo.findUnique({ where: { id }, include: { albums: { select: { albumId: true } } } });
  if (!row) return null;
  return { ...toPhotoDTO(row), albumIds: row.albums.map((a) => a.albumId) };
}

/**
 * Neighbors of `current` within a navigation scope, for the detail view's arrows
 * and film strip. `albumId` null = whole library; otherwise the album's photos
 * (regular or smart). Uses keyset cursoring on the current id over the given sort
 * order: a forward page (next) and a backward page (prev, negative take). Both come
 * back in sort order, so `before` ends with the nearest-prev and `strip` reads
 * left-to-right as the grid does. Selects only id+path to keep the window cheap.
 */
export async function getPhotoNeighbors(
  current: PhotoStripItem,
  albumId: string | null,
  sort: PhotoSort,
  window = 25,
  db: NeighborDb = prisma,
): Promise<PhotoNeighbors> {
  const where = albumId ? await albumPhotoWhere(albumId, db) : {};
  if (where === null) {
    // Album no longer exists — degrade to no navigation rather than throwing.
    return { prevId: null, nextId: null, strip: [current] };
  }
  return getNeighborsForWhere(current, where, sort, window, db);
}

/**
 * The prev/next + film-strip window over an arbitrary navigation scope (`where`),
 * ordered by the given sort. Used directly for search-scoped detail views;
 * `getPhotoNeighbors` wraps it for the album/library scopes. Keyset cursoring on
 * the current id: a forward page (next) and a backward page (prev, negative take).
 * Both come back in sort order, so `before` ends with the nearest-prev and `strip`
 * reads left-to-right as the grid does. Selects only id+path to keep the window cheap.
 */
export async function getNeighborsForWhere(
  current: PhotoStripItem,
  where: Prisma.PhotoWhereInput,
  sort: PhotoSort,
  window = 25,
  db: Db = prisma,
): Promise<PhotoNeighbors> {
  const select = { id: true, path: true } as const;
  const orderBy = photoOrderBy(sort);
  const [before, after] = await Promise.all([
    db.photo.findMany({
      where,
      cursor: { id: current.id },
      skip: 1,
      take: -window,
      orderBy,
      select,
    }),
    db.photo.findMany({
      where,
      cursor: { id: current.id },
      skip: 1,
      take: window,
      orderBy,
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
