import {
  type Prisma,
  type PrismaClient,
  type ShareLink,
  prisma,
  listShareLinksForCatalog,
  deleteShareLink as deleteShareLinkRow,
  findShareLinkByToken,
  shareLinkPhotoExists as shareLinkPhotoExistsRow,
  shareLinkPhotoWhere,
} from "@lumio/db";
import type { PhotosPage, PhotosQuery, ShareLinkSummaryDTO } from "@lumio/shared";
import { listPhotosForWhere } from "@/lib/server/photos-service";
import { LIVE_PHOTO } from "@/lib/server/photo-filters";
import { PHOTO_ORDER } from "@/lib/photo-order";
import { generateShareToken, hashPassword as hashPasswordImpl } from "@/lib/server/share-crypto";
import { isExpired } from "@/lib/server/share-access";

type Db = Pick<PrismaClient, "shareLink" | "shareLinkPhoto" | "photo" | "photoMetadataValue" | "metadataField">;

export class ShareLinkNotFoundError extends Error {
  constructor(message = "Share link not found") {
    super(message);
  }
}

interface CreateDeps {
  generateToken: () => string;
  hashPassword: (pw: string) => Promise<string>;
}
const DEFAULT_DEPS: CreateDeps = { generateToken: generateShareToken, hashPassword: hashPasswordImpl };

function buildUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/share/${token}`;
}

/** Create a link over the catalog-owned, live subset of `photoIds`. */
export async function createShareLink(
  catalogId: string,
  input: { photoIds: string[]; title?: string; password?: string; expiresAt?: string },
  opts: { baseUrl: string },
  db: Db = prisma,
  deps: CreateDeps = DEFAULT_DEPS,
): Promise<ShareLinkSummaryDTO> {
  // Only link photos that belong to this catalog and are live (never another
  // catalog's ids, never trashed photos). Ordered canonically so the create-time
  // cover (owned[0]) matches the cover listShareLinks later derives. If every id
  // is filtered out the link is created with zero members — a harmless empty
  // gallery; callers always pass a real in-catalog selection.
  const owned = await db.photo.findMany({
    where: { catalogId, ...LIVE_PHOTO, id: { in: input.photoIds } },
    orderBy: PHOTO_ORDER,
    select: { id: true },
  });
  const passwordHash = input.password ? await deps.hashPassword(input.password) : null;
  const row = await db.shareLink.create({
    data: {
      catalogId,
      token: deps.generateToken(),
      title: input.title ?? null,
      passwordHash,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      photos: { create: owned.map(({ id }) => ({ photoId: id })) },
    },
  });
  return summarize(row, opts.baseUrl, owned.length, owned[0]?.id ?? null);
}

function summarize(
  row: ShareLink,
  baseUrl: string,
  photoCount: number,
  coverPhotoId: string | null,
  now: Date = new Date(),
): ShareLinkSummaryDTO {
  return {
    id: row.id,
    token: row.token,
    url: buildUrl(baseUrl, row.token),
    title: row.title,
    hasPassword: row.passwordHash !== null,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    isExpired: isExpired(row.expiresAt, now),
    photoCount,
    coverPhotoId,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listShareLinks(
  catalogId: string,
  baseUrl: string,
  db: Db = prisma,
): Promise<ShareLinkSummaryDTO[]> {
  const rows = await listShareLinksForCatalog(catalogId, db);
  const now = new Date();
  return Promise.all(
    rows.map(async (row) => {
      const where: Prisma.PhotoWhereInput = { catalogId, ...LIVE_PHOTO, ...shareLinkPhotoWhere(row.id) };
      const [photoCount, cover] = await Promise.all([
        db.photo.count({ where }),
        db.photo.findFirst({ where, orderBy: PHOTO_ORDER, select: { id: true } }),
      ]);
      return summarize(row, baseUrl, photoCount, cover?.id ?? null, now);
    }),
  );
}

export async function deleteShareLinkChecked(catalogId: string, id: string, db: Db = prisma): Promise<void> {
  const count = await deleteShareLinkRow(catalogId, id, db);
  if (count === 0) throw new ShareLinkNotFoundError();
}

/** Resolve a token to its row (or null). No expiry/feature checks — see withShare. */
export function resolveShareLink(token: string, db: Db = prisma): Promise<ShareLink | null> {
  return findShareLinkByToken(token, db);
}

export { isExpired };

/** A page of a link's live member photos, in canonical order. */
export function listShareLinkPhotos(
  catalogId: string,
  shareLinkId: string,
  params: PhotosQuery,
  db: Db = prisma,
): Promise<PhotosPage> {
  const { limit, offset, sort } = params;
  return listPhotosForWhere(catalogId, shareLinkPhotoWhere(shareLinkId), { limit, offset, sort }, db);
}

/** Minimal {id,path,edits,wb} for every live member photo, for zipping (edited variant). */
export function listShareLinkPhotosForDownload(
  catalogId: string,
  shareLinkId: string,
  db: Db = prisma,
): Promise<{ id: string; path: string; edits: unknown; asShotTempK: number | null; asShotTint: number | null }[]> {
  return db.photo.findMany({
    where: { catalogId, ...LIVE_PHOTO, ...shareLinkPhotoWhere(shareLinkId) },
    orderBy: PHOTO_ORDER,
    select: { id: true, path: true, edits: true, asShotTempK: true, asShotTint: true },
  });
}

/** Like listShareLinkPhotosForDownload but limited to the requested ids that are
 *  actually live members of the link (never zips a non-member or trashed photo). */
export function listShareLinkPhotosForDownloadSubset(
  catalogId: string,
  shareLinkId: string,
  ids: string[],
  db: Db = prisma,
): Promise<{ id: string; path: string; edits: unknown; asShotTempK: number | null; asShotTint: number | null }[]> {
  return db.photo.findMany({
    where: { catalogId, ...LIVE_PHOTO, ...shareLinkPhotoWhere(shareLinkId), id: { in: ids } },
    orderBy: PHOTO_ORDER,
    select: { id: true, path: true, edits: true, asShotTempK: true, asShotTint: true },
  });
}

export function shareLinkPhotoExists(shareLinkId: string, photoId: string, db: Db = prisma): Promise<boolean> {
  return shareLinkPhotoExistsRow(shareLinkId, photoId, db);
}
