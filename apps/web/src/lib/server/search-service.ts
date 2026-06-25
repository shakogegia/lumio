import { type PrismaClient, buildSearchWhere, prisma } from "@lumio/db";
import { type PhotosPage, type SearchQuery, monthRange } from "@lumio/shared";
import { listPhotosForWhere } from "@/lib/server/photos-service";
import { LIVE_PHOTO } from "@/lib/server/photo-filters";

type Db = Pick<PrismaClient, "photo">;

/**
 * Inner (catalog-free) search where for `listPhotosForWhere` delegation. Returns
 * the search filter predicate without the `catalogId` constraint — that is added by
 * `listPhotosForWhere` itself. buildSearchWhere returns either {} or { AND: [...] };
 * the month range is ANDed in alongside it.
 */
function searchInnerWhere(params: SearchQuery) {
  const base = buildSearchWhere(params);
  if (!params.month) return base;
  return { AND: [base, { sortDate: monthRange(params.month) }] };
}

/** Catalog-scoped search where + the optional month range, AND-combined.
 *  Used only by countSearchPhotos which cannot delegate to listPhotosForWhere. */
function searchWhere(catalogId: string, params: SearchQuery) {
  // Merge catalogId into the base where (spread is safe: buildSearchWhere returns
  // either {} or { AND: [...] }, so catalogId just adds a key).
  const withCatalog = { catalogId, ...LIVE_PHOTO, ...buildSearchWhere(params) };
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
  return listPhotosForWhere(catalogId, searchInnerWhere(params), { limit, offset, sort }, db);
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
