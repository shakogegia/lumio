import type { Prisma, PrismaClient, ShareLink } from "@prisma/client";
import { prisma } from "./client.js";

type ShareLinkDb = Pick<PrismaClient, "shareLink">;
type ShareLinkPhotoDb = Pick<PrismaClient, "shareLinkPhoto">;

export function findShareLinkByToken(token: string, db: ShareLinkDb = prisma): Promise<ShareLink | null> {
  return db.shareLink.findUnique({ where: { token } });
}

export function listShareLinksForCatalog(catalogId: string, db: ShareLinkDb = prisma): Promise<ShareLink[]> {
  return db.shareLink.findMany({ where: { catalogId }, orderBy: { createdAt: "desc" } });
}

/** Delete a link scoped to its catalog. Returns rows removed (0 = not found). */
export async function deleteShareLink(catalogId: string, id: string, db: ShareLinkDb = prisma): Promise<number> {
  const { count } = await db.shareLink.deleteMany({ where: { id, catalogId } });
  return count;
}

export async function shareLinkPhotoExists(
  shareLinkId: string,
  photoId: string,
  db: ShareLinkPhotoDb = prisma,
): Promise<boolean> {
  const row = await db.shareLinkPhoto.findUnique({
    where: { shareLinkId_photoId: { shareLinkId, photoId } },
    select: { photoId: true },
  });
  return row !== null;
}

/** Prisma `where` selecting a share link's member photos (for listing/zip). */
export function shareLinkPhotoWhere(shareLinkId: string): Prisma.PhotoWhereInput {
  return { shareLinks: { some: { shareLinkId } } };
}
