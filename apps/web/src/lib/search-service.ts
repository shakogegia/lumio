import { type PrismaClient, buildSearchWhere, prisma, toPhotoDTO } from "@lumio/db";
import { type PhotosPage, type SearchQuery, monthRange } from "@lumio/shared";
import { photoOrderBy } from "@/lib/photo-order";

type Db = Pick<PrismaClient, "photo">;

/** Catalog-scoped search where + the optional month range, AND-combined. */
function searchWhere(catalogId: string, params: SearchQuery) {
  // Merge catalogId into the base where (spread is safe: buildSearchWhere returns
  // either {} or { AND: [...] }, so catalogId just adds a key).
  const withCatalog = { catalogId, ...buildSearchWhere(params) };
  return params.month
    ? { AND: [withCatalog, { sortDate: monthRange(params.month) }] }
    : withCatalog;
}

/**
 * Search the library by structured filters (albums) + free-text filename match,
 * optionally narrowed to a single month. Same offset pagination as `listPhotos`.
 * Scoped to the given catalog.
 */
export async function searchPhotos(
  catalogId: string,
  params: SearchQuery,
  db: Db = prisma,
): Promise<PhotosPage> {
  const { limit, offset, sort } = params;
  const where = searchWhere(catalogId, params);
  const [rows, total] = await Promise.all([
    db.photo.findMany({ where, skip: offset, take: limit, orderBy: photoOrderBy(sort) }),
    db.photo.count({ where }),
  ]);
  return { items: rows.map(toPhotoDTO), total };
}

/**
 * Count photos matching the search filters (and month, if set) — same `where` as
 * `searchPhotos`, minus pagination. Powers the result count in the search toolbar.
 * Scoped to the given catalog.
 */
export async function countSearchPhotos(
  catalogId: string,
  params: SearchQuery,
  db: Db = prisma,
): Promise<number> {
  return db.photo.count({ where: searchWhere(catalogId, params) });
}
