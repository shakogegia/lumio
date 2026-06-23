import { buildSearchWhere, type Prisma, type PrismaClient, prisma } from "@lumio/db";
import type { PhotoSort } from "@lumio/shared";
import { albumPhotoWhere } from "@/lib/albums-service";
import type { DetailScope } from "@/lib/photo-detail-loader";

export interface PhotoCursor {
  id: string;
  sortDate: Date;
  createdAt: Date;
  fileCreatedAt: Date;
}

type LocateDb = Pick<PrismaClient, "photo" | "album">;

/**
 * Prisma `where` matching every photo that sorts strictly BEFORE `cursor` in the
 * given sort order — i.e. the photos at lower grid indices. Mirrors
 * `photoOrderBy`: the date field, then `id`, in the same direction. Counting the
 * matches yields the cursor photo's absolute index in the ordered set.
 */
export function beforeCursorWhere(
  sort: PhotoSort | undefined,
  cursor: PhotoCursor,
): Prisma.PhotoWhereInput {
  const fileCreated = sort === "file-created-desc" || sort === "file-created-asc";
  const imported = sort === "imported-desc" || sort === "imported-asc";
  const field = fileCreated ? "fileCreatedAt" : imported ? "createdAt" : "sortDate";
  const value = fileCreated ? cursor.fileCreatedAt : imported ? cursor.createdAt : cursor.sortDate;
  const asc = sort === "taken-asc" || sort === "imported-asc" || sort === "file-created-asc";
  const dateBefore = asc ? { lt: value } : { gt: value };
  const idBefore = asc ? { lt: cursor.id } : { gt: cursor.id };
  // Computed key defeats TS narrowing; `field` is always a valid PhotoWhereInput key.
  return {
    OR: [{ [field]: dateBefore }, { AND: [{ [field]: value }, { id: idBefore }] }],
  } as Prisma.PhotoWhereInput;
}

async function scopeWhereFor(
  catalogId: string,
  scope: DetailScope,
  db: LocateDb,
): Promise<Prisma.PhotoWhereInput | null> {
  if (scope.kind === "album") return albumPhotoWhere(catalogId, scope.albumId, db);
  if (scope.kind === "search") return buildSearchWhere({ album: scope.albums, q: scope.q });
  if (scope.kind === "folder") return { dirPath: scope.dir };
  return {};
}

/**
 * Absolute index of `id` within a navigation scope's ordered set — the grid
 * offset the photo occupies, used to open the lightbox at the right position on a
 * deep link. Returns null when the photo is missing or outside the scope. Reuses
 * the SAME `where` + order (`photoOrderBy`) as the grid list endpoints and the
 * neighbor query, so the index aligns with the grid's offset pagination.
 *
 * `catalogId` scopes the Photo lookup so photos from other catalogs are never
 * found even if the id collides.
 */
export async function locatePhoto(
  catalogId: string,
  id: string,
  scope: DetailScope,
  db: LocateDb = prisma,
): Promise<number | null> {
  const row = await db.photo.findFirst({
    where: { id, catalogId },
    select: { id: true, sortDate: true, createdAt: true, fileCreatedAt: true },
  });
  if (!row) return null;
  const scopeWhere = await scopeWhereFor(catalogId, scope, db);
  if (scopeWhere === null) return null;
  const catalogScoped = { catalogId, ...scopeWhere };
  const [index, inScope] = await Promise.all([
    db.photo.count({ where: { AND: [catalogScoped, beforeCursorWhere(scope.sort, row)] } }),
    db.photo.count({ where: { AND: [catalogScoped, { id }] } }),
  ]);
  return inScope > 0 ? index : null;
}
