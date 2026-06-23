import { type Prisma, type PrismaClient, prisma, toPhotoDTO } from "@lumio/db";
import type {
  ColorLabel,
  PhotoNeighbors,
  PhotoSort,
  PhotosPage,
  PhotosQuery,
  PhotoStripItem,
} from "@lumio/shared";
import { monthRange } from "@lumio/shared";
import { albumPhotoWhere } from "@/lib/albums-service";
import { PHOTO_ORDER, photoOrderBy } from "@/lib/photo-order";

type Db = Pick<PrismaClient, "photo">;

type NeighborDb = Pick<PrismaClient, "photo" | "album">;

export async function listPhotos(
  catalogId: string,
  params: PhotosQuery,
  db: Db = prisma,
): Promise<PhotosPage> {
  const { limit, offset, sort, month, favorite } = params;
  const where: Prisma.PhotoWhereInput = {};
  if (month) where.sortDate = monthRange(month);
  if (favorite) where.isFavorite = true;
  return listPhotosForWhere(catalogId, where, { limit, offset, sort }, db);
}

/**
 * Offset-paginated page of photos matching an arbitrary `where`, ordered by
 * the given standard sort. Backs scopes whose set is a Prisma where (e.g. the
 * disk folder scope's `{ dirPath }`), mirroring `listPhotos`' page shape.
 */
export async function listPhotosForWhere(
  catalogId: string,
  where: Prisma.PhotoWhereInput,
  params: { limit: number; offset: number; sort?: PhotoSort },
  db: Db = prisma,
): Promise<PhotosPage> {
  const full: Prisma.PhotoWhereInput = { catalogId, ...where };
  const [rows, total] = await Promise.all([
    db.photo.findMany({
      where: full,
      skip: params.offset,
      take: params.limit,
      orderBy: photoOrderBy(params.sort),
    }),
    db.photo.count({ where: full }),
  ]);
  return { items: rows.map(toPhotoDTO), total };
}

/** Minimal {id, path, edits} for a set of photo ids, in canonical order, for zipping. */
export async function listPhotosForDownload(
  catalogId: string,
  ids: string[],
  db: Db = prisma,
): Promise<{ id: string; path: string; edits: unknown }[]> {
  return db.photo.findMany({
    where: { catalogId, id: { in: ids } },
    orderBy: PHOTO_ORDER,
    select: { id: true, path: true, edits: true },
  });
}

/**
 * Set (or clear, with `null`) the color label on a batch of photos.
 * Returns the number of rows updated.
 */
export async function setPhotoColorLabel(
  catalogId: string,
  photoIds: string[],
  label: ColorLabel | null,
  db: Db = prisma,
): Promise<number> {
  const { count } = await db.photo.updateMany({
    where: { catalogId, id: { in: photoIds } },
    data: { colorLabel: label },
  });
  return count;
}

/**
 * Set the favorite flag on a batch of photos. Returns the number of rows updated.
 */
export async function setPhotoFavorite(
  catalogId: string,
  photoIds: string[],
  isFavorite: boolean,
  db: Db = prisma,
): Promise<number> {
  const { count } = await db.photo.updateMany({
    where: { catalogId, id: { in: photoIds } },
    data: { isFavorite },
  });
  return count;
}

export async function photoExistsInCatalog(catalogId: string, id: string, db: Db = prisma): Promise<boolean> {
  return (await db.photo.findFirst({ where: { id, catalogId }, select: { id: true } })) !== null;
}

export async function photoOrTrashedExistsInCatalog(
  catalogId: string,
  id: string,
  db: Pick<PrismaClient, "photo" | "trashedPhoto"> = prisma,
): Promise<boolean> {
  const [photo, trashed] = await Promise.all([
    db.photo.findFirst({ where: { id, catalogId }, select: { id: true } }),
    db.trashedPhoto.findFirst({ where: { id, catalogId }, select: { id: true } }),
  ]);
  return photo !== null || trashed !== null;
}

export async function getPhoto(catalogId: string, id: string, db: Db = prisma) {
  const row = await db.photo.findFirst({ where: { id, catalogId }, include: { albums: { select: { albumId: true } } } });
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
  catalogId: string,
  current: PhotoStripItem,
  albumId: string | null,
  sort: PhotoSort,
  window = 25,
  db: NeighborDb = prisma,
): Promise<PhotoNeighbors> {
  const baseWhere = albumId ? await albumPhotoWhere(catalogId, albumId, db) : {};
  if (baseWhere === null) {
    // Album no longer exists — degrade to no navigation rather than throwing.
    return { prevId: null, nextId: null, strip: [current] };
  }
  const where: Prisma.PhotoWhereInput = { catalogId, ...baseWhere };
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
