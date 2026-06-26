import { type PrismaClient, buildSearchWhere, getCatalogSchema, prisma } from "@lumio/db";
import { DEFAULT_CALENDAR_FIELD, type PhotosPage, type SearchQuery, buildSearchRegistry } from "@lumio/shared";
import { albumsSearchWhere } from "@/lib/server/albums-service";
import { calendarWhere } from "@/lib/server/calendar-where";
import { listPhotosForWhere } from "@/lib/server/photos-service";
import { LIVE_PHOTO } from "@/lib/server/photo-filters";

// Needs `album` access too: tagged albums are resolved to a smart-aware predicate
// (membership OR smart-album rules) before compiling the search where.
type Db = Pick<PrismaClient, "photo" | "album" | "photoMetadataValue" | "metadataField">;

/**
 * Inner (catalog-free) search where for `listPhotosForWhere` delegation. Returns
 * the search filter predicate without the `catalogId` constraint — that is added by
 * `listPhotosForWhere` itself. buildSearchWhere returns either {} or { AND: [...] };
 * the month range is ANDed in alongside it. Loads the catalog's metadata schema to
 * build a registry so only configured fields are accepted in user filter rules, and
 * resolves the tagged albums to a smart-aware predicate (so smart albums match).
 */
async function searchInnerWhere(catalogId: string, params: SearchQuery, db: Db) {
  const now = new Date();
  const registry = buildSearchRegistry(await getCatalogSchema(catalogId));
  const albumWhere = await albumsSearchWhere(catalogId, params.album, { db, now, registry });
  const base = buildSearchWhere(params, now, registry, albumWhere);
  if (!params.month) return base;
  return { AND: [base, calendarWhere(params.dateField ?? DEFAULT_CALENDAR_FIELD, params.month)] };
}

/** Catalog-scoped search where + the optional month range, AND-combined.
 *  Used only by countSearchPhotos which cannot delegate to listPhotosForWhere. */
async function searchWhere(catalogId: string, params: SearchQuery, db: Db) {
  const now = new Date();
  const registry = buildSearchRegistry(await getCatalogSchema(catalogId));
  const albumWhere = await albumsSearchWhere(catalogId, params.album, { db, now, registry });
  // Merge catalogId into the base where (spread is safe: buildSearchWhere returns
  // either {} or { AND: [...] }, so catalogId just adds a key).
  const withCatalog = { catalogId, ...LIVE_PHOTO, ...buildSearchWhere(params, now, registry, albumWhere) };
  return params.month
    ? { AND: [withCatalog, calendarWhere(params.dateField ?? DEFAULT_CALENDAR_FIELD, params.month)] }
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
  return listPhotosForWhere(catalogId, await searchInnerWhere(catalogId, params, db), { limit, offset, sort }, db);
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
  return db.photo.count({ where: await searchWhere(catalogId, params, db) });
}
