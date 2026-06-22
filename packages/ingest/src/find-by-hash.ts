import type { PrismaClient } from "@lumio/db";

/** Find an already-indexed photo with the same content hash within a catalog, if any. */
export async function findPhotoByHash(
  catalogId: string,
  hash: string,
  db: Pick<PrismaClient, "photo">,
): Promise<{ id: string } | null> {
  return db.photo.findFirst({ where: { catalogId, hash }, select: { id: true } });
}
