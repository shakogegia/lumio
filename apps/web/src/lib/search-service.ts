import { type PrismaClient, buildSearchWhere, prisma, toPhotoDTO } from "@lumio/db";
import type { PhotosPage, SearchQuery } from "@lumio/shared";
import { photoOrderBy } from "@/lib/photo-order";

type Db = Pick<PrismaClient, "photo">;

/**
 * Search the library by structured filters (albums) + free-text filename match.
 * Same keyset-cursor pagination as `listPhotos`: the `where` only narrows the
 * same PHOTO_ORDER sequence, so cursors stay valid.
 */
export async function searchPhotos(params: SearchQuery, db: Db = prisma): Promise<PhotosPage> {
  const { limit, cursor, sort } = params;
  const rows = await db.photo.findMany({
    where: buildSearchWhere(params),
    take: limit,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    orderBy: photoOrderBy(sort),
  });
  const nextCursor = rows.length === limit ? (rows[rows.length - 1]?.id ?? null) : null;
  return { items: rows.map(toPhotoDTO), nextCursor };
}
