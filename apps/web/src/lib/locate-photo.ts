import { buildSearchWhere, type Prisma, type PrismaClient, prisma } from "@lumio/db";
import type { PhotoSort } from "@lumio/shared";
import { albumPhotoWhere } from "@/lib/albums-service";
import type { DetailScope } from "@/lib/photo-detail-loader";

export interface PhotoCursor {
  id: string;
  sortDate: Date;
  createdAt: Date;
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
  const imported = sort === "imported-desc" || sort === "imported-asc";
  const field = imported ? "createdAt" : "sortDate";
  const value = imported ? cursor.createdAt : cursor.sortDate;
  const asc = sort === "taken-asc" || sort === "imported-asc";
  const dateBefore = asc ? { lt: value } : { gt: value };
  const idBefore = asc ? { lt: cursor.id } : { gt: cursor.id };
  // Computed key defeats TS narrowing; `field` is always a valid PhotoWhereInput key.
  return {
    OR: [{ [field]: dateBefore }, { AND: [{ [field]: value }, { id: idBefore }] }],
  } as Prisma.PhotoWhereInput;
}

async function scopeWhereFor(
  scope: DetailScope,
  db: LocateDb,
): Promise<Prisma.PhotoWhereInput | null> {
  if (scope.kind === "album") return albumPhotoWhere(scope.albumId, db);
  if (scope.kind === "search") return buildSearchWhere({ album: scope.albums, q: scope.q });
  return {};
}

/**
 * Absolute index of `id` within a navigation scope's ordered set — the grid
 * offset the photo occupies, used to open the lightbox at the right position on a
 * deep link. Returns null when the photo is missing or outside the scope. Reuses
 * the SAME `where` + order (`photoOrderBy`) as the grid list endpoints and the
 * neighbor query, so the index aligns with the grid's offset pagination.
 */
export async function locatePhoto(
  id: string,
  scope: DetailScope,
  db: LocateDb = prisma,
): Promise<number | null> {
  const row = await db.photo.findUnique({
    where: { id },
    select: { id: true, sortDate: true, createdAt: true },
  });
  if (!row) return null;
  const scopeWhere = await scopeWhereFor(scope, db);
  if (scopeWhere === null) return null;
  const [index, inScope] = await Promise.all([
    db.photo.count({ where: { AND: [scopeWhere, beforeCursorWhere(scope.sort, row)] } }),
    db.photo.count({ where: { AND: [scopeWhere, { id }] } }),
  ]);
  return inScope > 0 ? index : null;
}
