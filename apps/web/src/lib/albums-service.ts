import { type Album, type Prisma, type PrismaClient, prisma, smartAlbumWhere, toAlbumDTO, toPhotoDTO } from "@lumio/db";
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

/** Shape one album row into a summary DTO (photo count + effective cover).
 *  Exported so the folders service can reuse identical album-card shaping.
 *  `now` is injected for smart-album evaluation. */
export async function albumSummary(
  catalogId: string,
  row: Album,
  db: Db = prisma,
  now: Date = new Date(),
): Promise<AlbumSummaryDTO> {
  const base = toAlbumDTO(row);
  if (row.isSmart) {
    const smartWhere = smartAlbumWhere(base.rules as SmartAlbumRules, now);
    const where = { catalogId, ...smartWhere };
    const [photoCount, cover] = await Promise.all([
      db.photo.count({ where }),
      db.photo.findFirst({ where, orderBy: PHOTO_ORDER, select: { id: true } }),
    ]);
    return { ...base, photoCount, coverPhotoId: cover?.id ?? null };
  }
  const photoCount = await db.albumPhoto.count({ where: { albumId: row.id } });
  let coverPhotoId: string | null = null;
  // Honor an explicitly pinned cover only while that photo is still a member.
  if (row.coverPhotoId) {
    const pinned = await db.albumPhoto.findUnique({
      where: { albumId_photoId: { albumId: row.id, photoId: row.coverPhotoId } },
      select: { photoId: true },
    });
    if (pinned) coverPhotoId = pinned.photoId;
  }
  // Fall back to the most-recent member.
  if (!coverPhotoId) {
    const cover = await db.albumPhoto.findFirst({
      where: { albumId: row.id },
      orderBy: { photo: { sortDate: "desc" } },
      select: { photoId: true },
    });
    coverPhotoId = cover?.photoId ?? null;
  }
  return { ...base, photoCount, coverPhotoId };
}

export async function listAlbumSummaries(catalogId: string, db: Db = prisma): Promise<AlbumSummaryDTO[]> {
  const albums = await db.album.findMany({ where: { catalogId }, orderBy: { createdAt: "asc" } });
  const now = new Date();
  return Promise.all(albums.map((a) => albumSummary(catalogId, a, db, now)));
}

export async function getAlbum(catalogId: string, id: string, db: Db = prisma): Promise<AlbumDTO | null> {
  const row = await db.album.findFirst({ where: { id, catalogId } });
  return row ? toAlbumDTO(row) : null;
}

export async function createAlbum(catalogId: string, input: CreateAlbumInput, db: Db = prisma): Promise<AlbumDTO> {
  const row = await db.album.create({
    data: {
      catalogId,
      name: input.name,
      isSmart: input.isSmart,
      rules: input.isSmart ? (input.rules as object) : undefined,
      folderId: input.folderId ?? null,
    },
  });
  return toAlbumDTO(row);
}

export async function deleteAlbum(catalogId: string, id: string, db: Db = prisma): Promise<void> {
  const found = await db.album.findFirst({ where: { id, catalogId }, select: { id: true } });
  if (!found) throw new AlbumNotFoundError();
  await db.album.delete({ where: { id } });
}

/**
 * Bulk-delete albums by id. Tolerant of unknown ids (unlike single
 * `deleteAlbum`, which throws). Works for smart and regular albums alike;
 * cascades to `albumPhoto` membership rows exactly like the single delete.
 * Returns the number of albums actually removed.
 */
export async function deleteAlbums(catalogId: string, ids: string[], db: Db = prisma): Promise<number> {
  const { count } = await db.album.deleteMany({ where: { catalogId, id: { in: ids } } });
  return count;
}

export async function renameAlbum(catalogId: string, id: string, name: string, db: Db = prisma): Promise<AlbumDTO> {
  const found = await db.album.findFirst({ where: { id, catalogId }, select: { id: true } });
  if (!found) throw new AlbumNotFoundError();
  const row = await db.album.update({ where: { id }, data: { name } });
  return toAlbumDTO(row);
}

/**
 * Prisma `where` selecting the photos in an album's navigation scope: explicit
 * membership for a regular album, or the smart-album rule predicate for a smart
 * one. Returns null when the album does not exist.
 */
export async function albumPhotoWhere(
  catalogId: string,
  albumId: string,
  db: Pick<PrismaClient, "album"> = prisma,
): Promise<Prisma.PhotoWhereInput | null> {
  const album = await db.album.findFirst({ where: { id: albumId, catalogId } });
  if (!album) return null;
  const dto = toAlbumDTO(album);
  return dto.isSmart
    ? smartAlbumWhere(dto.rules as SmartAlbumRules, new Date())
    : { albums: { some: { albumId } } };
}

export async function listAlbumPhotos(
  catalogId: string,
  id: string,
  params: PhotosQuery,
  db: Db = prisma,
): Promise<PhotosPage | null> {
  const scoped = await albumPhotoWhere(catalogId, id, db);
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
  catalogId: string,
  id: string,
  db: Db = prisma,
): Promise<{ id: string; path: string }[] | null> {
  const where = await albumPhotoWhere(catalogId, id, db);
  if (where === null) return null;
  return db.photo.findMany({
    where,
    orderBy: PHOTO_ORDER,
    select: { id: true, path: true },
  });
}

export class SmartAlbumMutationError extends Error {}

export class AlbumNotFoundError extends Error {}

export class PhotoNotInAlbumError extends Error {}

export async function removePhotoFromAlbum(catalogId: string, albumId: string, photoId: string, db: Db = prisma): Promise<void> {
  const album = await db.album.findFirst({ where: { id: albumId, catalogId }, select: { id: true } });
  if (!album) return;
  await db.albumPhoto.deleteMany({ where: { albumId, photoId } });
  // If the removed photo was the pinned cover, drop the pin so the cover defaults
  // back to the derived most-recent member.
  await db.album.updateMany({
    where: { id: albumId, coverPhotoId: photoId },
    data: { coverPhotoId: null },
  });
}

export async function addPhotosToAlbum(
  catalogId: string,
  albumId: string,
  photoIds: string[],
  db: Db = prisma,
): Promise<number> {
  const album = await db.album.findFirst({ where: { id: albumId, catalogId }, select: { isSmart: true } });
  if (!album) throw new AlbumNotFoundError();
  if (album.isSmart) throw new SmartAlbumMutationError("cannot add photos to a smart album");
  const result = await db.albumPhoto.createMany({
    data: photoIds.map((photoId) => ({ albumId, photoId })),
    skipDuplicates: true,
  });
  return result.count;
}

/**
 * Pin `photoId` as the album's cover. Regular albums only; the photo must already
 * be a member. The pin is honored by `listAlbumSummaries` only while the photo
 * stays a member (see the membership check there) and is eager-cleared on removal.
 */
export async function setAlbumCover(catalogId: string, albumId: string, photoId: string, db: Db = prisma): Promise<void> {
  const album = await db.album.findFirst({ where: { id: albumId, catalogId }, select: { isSmart: true } });
  if (!album) throw new AlbumNotFoundError();
  if (album.isSmart) throw new SmartAlbumMutationError("cannot set a cover on a smart album");
  const member = await db.albumPhoto.findUnique({
    where: { albumId_photoId: { albumId, photoId } },
    select: { photoId: true },
  });
  if (!member) throw new PhotoNotInAlbumError();
  await db.album.update({ where: { id: albumId }, data: { coverPhotoId: photoId } });
}

export async function removePhotosFromAlbum(
  catalogId: string,
  albumId: string,
  photoIds: string[],
  db: Db = prisma,
): Promise<number> {
  const album = await db.album.findFirst({ where: { id: albumId, catalogId }, select: { isSmart: true } });
  if (!album) throw new AlbumNotFoundError();
  if (album.isSmart) throw new SmartAlbumMutationError("cannot remove photos from a smart album");
  const result = await db.albumPhoto.deleteMany({
    where: { albumId, photoId: { in: photoIds } },
  });
  await db.album.updateMany({
    where: { id: albumId, coverPhotoId: { in: photoIds } },
    data: { coverPhotoId: null },
  });
  return result.count;
}
