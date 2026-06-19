import { type PrismaClient, buildSearchWhere, prisma, toPhotoDTO } from "@lumio/db";
import type { PhotosPage, SearchQuery } from "@lumio/shared";
import { photoOrderBy } from "@/lib/photo-order";

type Db = Pick<PrismaClient, "photo">;

/**
 * Search the library by structured filters (albums) + free-text filename match.
 * Same offset pagination as `listPhotos` (`skip`/`take` + a `total` count); the
 * `where` only narrows the same sorted sequence.
 */
export async function searchPhotos(params: SearchQuery, db: Db = prisma): Promise<PhotosPage> {
  const { limit, offset, sort } = params;
  const where = buildSearchWhere(params);
  const [rows, total] = await Promise.all([
    db.photo.findMany({ where, skip: offset, take: limit, orderBy: photoOrderBy(sort) }),
    db.photo.count({ where }),
  ]);
  return { items: rows.map(toPhotoDTO), total };
}

/**
 * Count photos matching the search filters — same `where` as `searchPhotos`,
 * minus pagination. Powers the result count shown in the search toolbar.
 */
export async function countSearchPhotos(params: SearchQuery, db: Db = prisma): Promise<number> {
  return db.photo.count({ where: buildSearchWhere(params) });
}
