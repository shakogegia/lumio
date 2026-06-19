import type { Prisma } from "@prisma/client";

/**
 * Translate search filters into a Prisma Photo where clause. Mirrors
 * `smartAlbumWhere`'s style: pure, no DB access. Albums OR within the facet
 * (membership in any of the ids); facet clauses AND together. Empty filters
 * yield `{}` (matches the whole library, same as the unfiltered listing).
 */
export function buildSearchWhere(p: { q?: string; album: string[] }): Prisma.PhotoWhereInput {
  const clauses: Prisma.PhotoWhereInput[] = [];
  if (p.album.length > 0) {
    clauses.push({ albums: { some: { albumId: { in: p.album } } } });
  }
  if (p.q) {
    clauses.push({ path: { contains: p.q, mode: "insensitive" } });
  }
  return clauses.length > 0 ? { AND: clauses } : {};
}
