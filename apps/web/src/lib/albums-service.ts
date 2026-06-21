import { type Prisma, type PrismaClient, prisma, smartAlbumWhere, toAlbumDTO, toPhotoDTO } from "@lumio/db";
import {
  monthRange,
  type AlbumDTO,
  type AlbumSummaryDTO,
  type CreateAlbumInput,
  type PhotosPage,
  type PhotosQuery,
  type SmartAlbumRules,
} from "@lumio/shared";
import { PHOTO_ORDER, photoOrderBy } from "@/lib/photo-order";

type Db = Pick<PrismaClient, "album" | "albumPhoto" | "photo">;

export async function listAlbumSummaries(db: Db = prisma): Promise<AlbumSummaryDTO[]> {
  const albums = await db.album.findMany({ orderBy: { createdAt: "asc" } });
  const now = new Date();
  return Promise.all(
    albums.map(async (a) => {
      const base = toAlbumDTO(a);
      if (a.isSmart) {
        const where = smartAlbumWhere(base.rules as SmartAlbumRules, now);
        const [photoCount, cover] = await Promise.all([
          db.photo.count({ where }),
          db.photo.findFirst({ where, orderBy: PHOTO_ORDER, select: { id: true } }),
        ]);
        return { ...base, photoCount, coverPhotoId: cover?.id ?? null };
      }
      const photoCount = await db.albumPhoto.count({ where: { albumId: a.id } });
      let coverPhotoId: string | null = null;
      if (a.coverPhotoId) {
        const pinned = await db.albumPhoto.findUnique({
          where: { albumId_photoId: { albumId: a.id, photoId: a.coverPhotoId } },
          select: { photoId: true },
        });
        if (pinned) coverPhotoId = pinned.photoId;
      }
      if (!coverPhotoId) {
        const cover = await db.albumPhoto.findFirst({
          where: { albumId: a.id },
          orderBy: { photo: { sortDate: "desc" } },
          select: { photoId: true },
        });
        coverPhotoId = cover?.photoId ?? null;
      }
      return { ...base, photoCount, coverPhotoId };
    }),
  );
}

export async function getAlbum(id: string, db: Db = prisma): Promise<AlbumDTO | null> {
  const row = await db.album.findUnique({ where: { id } });
  return row ? toAlbumDTO(row) : null;
}

export async function createAlbum(input: CreateAlbumInput, db: Db = prisma): Promise<AlbumDTO> {
  const row = await db.album.create({
    data: {
      name: input.name,
      isSmart: input.isSmart,
      rules: input.isSmart ? (input.rules as object) : undefined,
    },
  });
  return toAlbumDTO(row);
}

export async function deleteAlbum(id: string, db: Db = prisma): Promise<void> {
  const found = await db.album.findUnique({ where: { id }, select: { id: true } });
  if (!found) throw new AlbumNotFoundError();
  await db.album.delete({ where: { id } });
}

/**
 * Bulk-delete albums by id. Tolerant of unknown ids (unlike single
 * `deleteAlbum`, which throws). Works for smart and regular albums alike;
 * cascades to `albumPhoto` membership rows exactly like the single delete.
 * Returns the number of albums actually removed.
 */
export async function deleteAlbums(ids: string[], db: Db = prisma): Promise<number> {
  const { count } = await db.album.deleteMany({ where: { id: { in: ids } } });
  return count;
}

/**
 * Prisma `where` selecting the photos in an album's navigation scope: explicit
 * membership for a regular album, or the smart-album rule predicate for a smart
 * one. Returns null when the album does not exist.
 */
export async function albumPhotoWhere(
  albumId: string,
  db: Pick<PrismaClient, "album"> = prisma,
): Promise<Prisma.PhotoWhereInput | null> {
  const album = await db.album.findUnique({ where: { id: albumId } });
  if (!album) return null;
  const dto = toAlbumDTO(album);
  return dto.isSmart
    ? smartAlbumWhere(dto.rules as SmartAlbumRules, new Date())
    : { albums: { some: { albumId } } };
}

export async function listAlbumPhotos(
  id: string,
  params: PhotosQuery,
  db: Db = prisma,
): Promise<PhotosPage | null> {
  const scoped = await albumPhotoWhere(id, db);
  if (scoped === null) return null;
  const { limit, offset, sort, month } = params;
  const where = month ? { AND: [scoped, { sortDate: monthRange(month) }] } : scoped;
  const [rows, total] = await Promise.all([
    db.photo.findMany({ where, skip: offset, take: limit, orderBy: photoOrderBy(sort) }),
    db.photo.count({ where }),
  ]);
  return { items: rows.map(toPhotoDTO), total };
}

/** Minimal {id, path} for every photo in an album (smart or regular), in
 *  canonical order, for zipping. Returns null when the album does not exist. */
export async function listAlbumPhotosForDownload(
  id: string,
  db: Db = prisma,
): Promise<{ id: string; path: string }[] | null> {
  const where = await albumPhotoWhere(id, db);
  if (where === null) return null;
  return db.photo.findMany({
    where,
    orderBy: PHOTO_ORDER,
    select: { id: true, path: true },
  });
}

export class SmartAlbumMutationError extends Error {}

export class AlbumNotFoundError extends Error {}

export async function removePhotoFromAlbum(albumId: string, photoId: string, db: Db = prisma): Promise<void> {
  await db.albumPhoto.deleteMany({ where: { albumId, photoId } });
}

export async function addPhotosToAlbum(
  albumId: string,
  photoIds: string[],
  db: Db = prisma,
): Promise<number> {
  const album = await db.album.findUnique({ where: { id: albumId }, select: { isSmart: true } });
  if (!album) throw new AlbumNotFoundError();
  if (album.isSmart) throw new SmartAlbumMutationError("cannot add photos to a smart album");
  const result = await db.albumPhoto.createMany({
    data: photoIds.map((photoId) => ({ albumId, photoId })),
    skipDuplicates: true,
  });
  return result.count;
}

export async function removePhotosFromAlbum(
  albumId: string,
  photoIds: string[],
  db: Db = prisma,
): Promise<number> {
  const album = await db.album.findUnique({ where: { id: albumId }, select: { isSmart: true } });
  if (!album) throw new AlbumNotFoundError();
  if (album.isSmart) throw new SmartAlbumMutationError("cannot remove photos from a smart album");
  const result = await db.albumPhoto.deleteMany({
    where: { albumId, photoId: { in: photoIds } },
  });
  return result.count;
}
