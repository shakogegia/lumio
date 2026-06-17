import { type PrismaClient, prisma, smartAlbumWhere, toAlbumDTO, toPhotoDTO } from "@lumio/db";
import {
  type AlbumDTO,
  type AlbumSummaryDTO,
  type CreateAlbumInput,
  type PhotosPage,
  type PhotosQuery,
  type SmartAlbumRules,
} from "@lumio/shared";

type Db = Pick<PrismaClient, "album" | "albumPhoto" | "photo">;

const PHOTO_ORDER = [{ sortDate: "desc" as const }, { id: "desc" as const }];

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
      const [photoCount, cover] = await Promise.all([
        db.albumPhoto.count({ where: { albumId: a.id } }),
        db.albumPhoto.findFirst({
          where: { albumId: a.id },
          orderBy: { photo: { sortDate: "desc" } },
          select: { photoId: true },
        }),
      ]);
      return { ...base, photoCount, coverPhotoId: cover?.photoId ?? null };
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

export async function listAlbumPhotos(
  id: string,
  params: PhotosQuery,
  db: Db = prisma,
): Promise<PhotosPage | null> {
  const album = await db.album.findUnique({ where: { id } });
  if (!album) return null;
  const dto = toAlbumDTO(album);
  const where = dto.isSmart
    ? smartAlbumWhere(dto.rules as SmartAlbumRules, new Date())
    : { albums: { some: { albumId: id } } };
  const { limit, cursor } = params;
  const rows = await db.photo.findMany({
    where,
    take: limit,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    orderBy: PHOTO_ORDER,
  });
  const nextCursor = rows.length === limit ? (rows[rows.length - 1]?.id ?? null) : null;
  return { items: rows.map(toPhotoDTO), nextCursor };
}

export class SmartAlbumMutationError extends Error {}

export class AlbumNotFoundError extends Error {}

export async function addPhotoToAlbum(albumId: string, photoId: string, db: Db = prisma): Promise<void> {
  const album = await db.album.findUnique({ where: { id: albumId }, select: { isSmart: true } });
  if (!album) throw new AlbumNotFoundError();
  if (album.isSmart) throw new SmartAlbumMutationError("cannot add photos to a smart album");
  await db.albumPhoto.upsert({
    where: { albumId_photoId: { albumId, photoId } },
    create: { albumId, photoId },
    update: {},
  });
}

export async function removePhotoFromAlbum(albumId: string, photoId: string, db: Db = prisma): Promise<void> {
  await db.albumPhoto.deleteMany({ where: { albumId, photoId } });
}
