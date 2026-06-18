import type { PrismaClient } from "@lumio/db";

/** Find an already-indexed photo with the same content hash, if any. */
export async function findPhotoByHash(
  hash: string,
  db: Pick<PrismaClient, "photo">,
): Promise<{ id: string } | null> {
  return db.photo.findFirst({ where: { hash }, select: { id: true } });
}
