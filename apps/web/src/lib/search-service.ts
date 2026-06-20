import { type PrismaClient, buildSearchWhere, prisma, toPhotoDTO } from "@lumio/db";
import { type PhotosPage, type SearchQuery, monthRange } from "@lumio/shared";
import { photoOrderBy } from "@/lib/photo-order";

type Db = Pick<PrismaClient, "photo">;

/** Search where + the optional month range, AND-combined. */
function searchWhere(params: SearchQuery) {
  const scoped = buildSearchWhere(params);
  return params.month ? { AND: [scoped, { sortDate: monthRange(params.month) }] } : scoped;
}

/**
 * Search the library by structured filters (albums) + free-text filename match,
 * optionally narrowed to a single month. Same offset pagination as `listPhotos`.
 */
export async function searchPhotos(params: SearchQuery, db: Db = prisma): Promise<PhotosPage> {
  const { limit, offset, sort } = params;
  const where = searchWhere(params);
  const [rows, total] = await Promise.all([
    db.photo.findMany({ where, skip: offset, take: limit, orderBy: photoOrderBy(sort) }),
    db.photo.count({ where }),
  ]);
  return { items: rows.map(toPhotoDTO), total };
}

/**
 * Count photos matching the search filters (and month, if set) — same `where` as
 * `searchPhotos`, minus pagination. Powers the result count in the search toolbar.
 */
export async function countSearchPhotos(params: SearchQuery, db: Db = prisma): Promise<number> {
  return db.photo.count({ where: searchWhere(params) });
}
