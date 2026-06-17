import { type PrismaClient, prisma, toPhotoDTO } from "@lumio/db";
import type { PhotosPage, PhotosQuery } from "@lumio/shared";

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
  const row = await db.photo.findUnique({ where: { id } });
  return row ? toPhotoDTO(row) : null;
}
