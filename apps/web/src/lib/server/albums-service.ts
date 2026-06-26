import { type Album, type Prisma, type PrismaClient, getCatalogSchema, prisma, smartAlbumWhere, toAlbumDTO } from "@lumio/db";
import {
  buildSearchRegistry,
  monthRange,
  type AlbumDTO,
  type AlbumSummaryDTO,
  type CreateAlbumInput,
  type PhotosPage,
  type PhotosQuery,
  type SearchRegistry,
  type SmartAlbumRules,
} from "@lumio/shared";
import { PHOTO_ORDER } from "@/lib/photo-order";
import { listPhotosForWhere } from "@/lib/server/photos-service";
import { LIVE_PHOTO } from "@/lib/server/photo-filters";

type Db = Pick<PrismaClient, "album" | "albumPhoto" | "photo">;

/** The effective cover photo id for one album: the pinned cover while it is still a
 *  member, otherwise the most-recent member; smart albums use the newest rule-match.
 *  Single-sourced so the folders service derives folder-preview covers identically. */
export async function albumCoverId(
  catalogId: string,
  row: Album,
  db: Db = prisma,
  now: Date = new Date(),
): Promise<string | null> {
  if (row.isSmart) {
    const registry = buildSearchRegistry(await getCatalogSchema(catalogId));
    const smartWhere = smartAlbumWhere(toAlbumDTO(row).rules as SmartAlbumRules, now, registry);
    const cover = await db.photo.findFirst({
      where: { catalogId, ...LIVE_PHOTO, ...smartWhere },
      orderBy: PHOTO_ORDER,
      select: { id: true },
    });
    return cover?.id ?? null;
  }
  // Honor an explicitly pinned cover only while that photo is still a member.
  if (row.coverPhotoId) {
    const pinned = await db.albumPhoto.findUnique({
      where: { albumId_photoId: { albumId: row.id, photoId: row.coverPhotoId } },
      select: { photoId: true },
    });
    if (pinned) return pinned.photoId;
  }
  // Fall back to the most-recent member.
  const cover = await db.albumPhoto.findFirst({
    where: { albumId: row.id },
    orderBy: { photo: { sortDate: "desc" } },
    select: { photoId: true },
  });
  return cover?.photoId ?? null;
}

/** Resolve covers for many album rows in one parallel pass: Map<albumId, coverPhotoId|null>. */
export async function albumCoverMap(
  catalogId: string,
  rows: Album[],
  db: Db = prisma,
  now: Date = new Date(),
): Promise<Map<string, string | null>> {
  const entries = await Promise.all(
    rows.map(async (r) => [r.id, await albumCoverId(catalogId, r, db, now)] as const),
  );
  return new Map(entries);
}

/** Shape one album row into a summary DTO (photo count + effective cover).
 *  Exported so the folders service can reuse identical album-card shaping.
 *  `now` is injected for smart-album evaluation. */
export async function albumSummary(
  catalogId: string,
  row: Album,
  db: Db = prisma,
  now: Date = new Date(),
): Promise<AlbumSummaryDTO> {
  const base = toAlbumDTO(row);
  if (row.isSmart) {
    const registry = buildSearchRegistry(await getCatalogSchema(catalogId));
    const smartWhere = smartAlbumWhere(base.rules as SmartAlbumRules, now, registry);
    const where = { catalogId, ...LIVE_PHOTO, ...smartWhere };
    const [photoCount, coverPhotoId] = await Promise.all([
      db.photo.count({ where }),
      albumCoverId(catalogId, row, db, now),
    ]);
    return { ...base, photoCount, coverPhotoId };
  }
  const [photoCount, coverPhotoId] = await Promise.all([
    db.albumPhoto.count({ where: { albumId: row.id } }),
    albumCoverId(catalogId, row, db, now),
  ]);
  return { ...base, photoCount, coverPhotoId };
}

export async function listAlbumSummaries(catalogId: string, db: Db = prisma): Promise<AlbumSummaryDTO[]> {
  const albums = await db.album.findMany({ where: { catalogId }, orderBy: { createdAt: "asc" } });
  const now = new Date();
  return Promise.all(albums.map((a) => albumSummary(catalogId, a, db, now)));
}

export async function getAlbum(catalogId: string, id: string, db: Db = prisma): Promise<AlbumDTO | null> {
  const row = await db.album.findFirst({ where: { id, catalogId } });
  return row ? toAlbumDTO(row) : null;
}

export async function createAlbum(catalogId: string, input: CreateAlbumInput, db: Db = prisma): Promise<AlbumDTO> {
  const row = await db.album.create({
    data: {
      catalogId,
      name: input.name,
      isSmart: input.isSmart,
      rules: input.isSmart ? (input.rules as object) : undefined,
      folderId: input.folderId ?? null,
    },
  });
  return toAlbumDTO(row);
}

export async function deleteAlbum(catalogId: string, id: string, db: Db = prisma): Promise<void> {
  const found = await db.album.findFirst({ where: { id, catalogId }, select: { id: true } });
  if (!found) throw new AlbumNotFoundError();
  await db.album.delete({ where: { id } });
}

/**
 * Bulk-delete albums by id. Tolerant of unknown ids (unlike single
 * `deleteAlbum`, which throws). Works for smart and regular albums alike;
 * cascades to `albumPhoto` membership rows exactly like the single delete.
 * Returns the number of albums actually removed.
 */
export async function deleteAlbums(catalogId: string, ids: string[], db: Db = prisma): Promise<number> {
  const { count } = await db.album.deleteMany({ where: { catalogId, id: { in: ids } } });
  return count;
}

export async function renameAlbum(catalogId: string, id: string, name: string, db: Db = prisma): Promise<AlbumDTO> {
  const found = await db.album.findFirst({ where: { id, catalogId }, select: { id: true } });
  if (!found) throw new AlbumNotFoundError();
  const row = await db.album.update({ where: { id }, data: { name } });
  return toAlbumDTO(row);
}

/**
 * Prisma `where` selecting the photos in an album's navigation scope: explicit
 * membership for a regular album, or the smart-album rule predicate for a smart
 * one. Returns null when the album does not exist.
 */
export async function albumPhotoWhere(
  catalogId: string,
  albumId: string,
  db: Pick<PrismaClient, "album"> = prisma,
): Promise<Prisma.PhotoWhereInput | null> {
  const album = await db.album.findFirst({ where: { id: albumId, catalogId } });
  if (!album) return null;
  const dto = toAlbumDTO(album);
  if (dto.isSmart) {
    const registry = buildSearchRegistry(await getCatalogSchema(catalogId));
    return smartAlbumWhere(dto.rules as SmartAlbumRules, new Date(), registry);
  }
  return { albums: { some: { albumId } } };
}

/**
 * Prisma `where` selecting the photos in ANY of the given albums — the album
 * scope for SEARCH (multiple tagged albums = OR). Regular albums contribute an
 * AlbumPhoto membership clause; smart albums contribute their rule predicate
 * (`smartAlbumWhere`). The branches are OR-combined.
 *
 * This is the search-path counterpart to `albumPhotoWhere` (single album, album
 * view). It exists because the pure `buildSearchWhere` compiler has no DB access
 * and so cannot tell which tagged ids are smart — without this, smart albums
 * compile to a membership query and match nothing (they have no AlbumPhoto rows).
 *
 *  • no ids            → undefined (no album constraint)
 *  • all ids unknown   → { id: { in: [] } } (match nothing, like a stale membership query)
 *  • registry omitted  → built lazily, only when a smart album is present
 */
export async function albumsSearchWhere(
  catalogId: string,
  albumIds: string[],
  opts: { db?: Pick<PrismaClient, "album">; now?: Date; registry?: SearchRegistry } = {},
): Promise<Prisma.PhotoWhereInput | undefined> {
  if (albumIds.length === 0) return undefined;
  const db = opts.db ?? prisma;
  const albums = await db.album.findMany({ where: { catalogId, id: { in: albumIds } } });
  if (albums.length === 0) return { id: { in: [] } };

  const branches: Prisma.PhotoWhereInput[] = [];
  const regularIds = albums.filter((a) => !a.isSmart).map((a) => a.id);
  if (regularIds.length > 0) branches.push({ albums: { some: { albumId: { in: regularIds } } } });

  const smartAlbums = albums.filter((a) => a.isSmart);
  if (smartAlbums.length > 0) {
    const now = opts.now ?? new Date();
    const registry = opts.registry ?? buildSearchRegistry(await getCatalogSchema(catalogId));
    for (const album of smartAlbums) {
      branches.push(smartAlbumWhere(toAlbumDTO(album).rules as SmartAlbumRules, now, registry));
    }
  }
  return branches.length === 1 ? branches[0] : { OR: branches };
}

export async function listAlbumPhotos(
  catalogId: string,
  id: string,
  params: PhotosQuery,
  db: Db = prisma,
): Promise<PhotosPage | null> {
  const scoped = await albumPhotoWhere(catalogId, id, db);
  if (scoped === null) return null;
  const { limit, offset, sort, month } = params;
  // Scope by catalog: a SMART album's where is just its rule predicate (no
  // catalog constraint), so without this it would match photos in EVERY catalog.
  // listPhotosForWhere adds catalogId at the top level; AND the month range in alongside scoped.
  const innerWhere: Prisma.PhotoWhereInput = month
    ? { AND: [scoped, { sortDate: monthRange(month) }] }
    : scoped;
  return listPhotosForWhere(catalogId, innerWhere, { limit, offset, sort }, db);
}

/** Minimal {id, path} for every photo in an album (smart or regular), in
 *  canonical order, for zipping. Returns null when the album does not exist. */
export async function listAlbumPhotosForDownload(
  catalogId: string,
  id: string,
  db: Db = prisma,
): Promise<{ id: string; path: string }[] | null> {
  const scoped = await albumPhotoWhere(catalogId, id, db);
  if (scoped === null) return null;
  // Scope by catalog (see listAlbumPhotos) so a smart album never zips photos
  // from another catalog.
  return db.photo.findMany({
    where: { catalogId, ...LIVE_PHOTO, ...scoped },
    orderBy: PHOTO_ORDER,
    select: { id: true, path: true },
  });
}

export class SmartAlbumMutationError extends Error {}

export class AlbumNotFoundError extends Error {
  constructor(message = "Album not found") {
    super(message);
  }
}

/**
 * Returns the field names of rules that are not valid for this catalog's
 * configured metadata schema. An empty array means all rules are valid.
 *
 * Accepts an optional pre-built `registry` to enable unit testing without
 * hitting the database.
 */
export async function invalidRuleFields(
  catalogId: string,
  rules: { field: string; op: string }[],
  registry?: SearchRegistry,
): Promise<string[]> {
  const reg = registry ?? buildSearchRegistry(await getCatalogSchema(catalogId));
  return rules
    .filter((r) => {
      const d = reg.get(r.field);
      return !d || (d.ops.length > 0 && !d.ops.includes(r.op as never));
    })
    .map((r) => r.field);
}

/**
 * Replace the rules of an existing smart album. Returns the updated DTO, or
 * null if the album does not exist in this catalog or is not a smart album.
 */
export async function updateAlbumRules(
  catalogId: string,
  albumId: string,
  rules: SmartAlbumRules,
  db: Db = prisma,
): Promise<AlbumDTO | null> {
  const album = await db.album.findFirst({ where: { id: albumId, catalogId } });
  if (!album) return null;
  if (!album.isSmart) return null;
  const updated = await db.album.update({ where: { id: albumId }, data: { rules: rules as object } });
  return toAlbumDTO(updated);
}

export class PhotoNotInAlbumError extends Error {
  constructor(message = "Photo is not in this album") {
    super(message);
  }
}

export async function removePhotoFromAlbum(catalogId: string, albumId: string, photoId: string, db: Db = prisma): Promise<void> {
  const album = await db.album.findFirst({ where: { id: albumId, catalogId }, select: { id: true } });
  if (!album) return;
  await db.albumPhoto.deleteMany({ where: { albumId, photoId } });
  // If the removed photo was the pinned cover, drop the pin so the cover defaults
  // back to the derived most-recent member.
  await db.album.updateMany({
    where: { id: albumId, coverPhotoId: photoId },
    data: { coverPhotoId: null },
  });
}

export async function addPhotosToAlbum(
  catalogId: string,
  albumId: string,
  photoIds: string[],
  db: Db = prisma,
): Promise<number> {
  const album = await db.album.findFirst({ where: { id: albumId, catalogId }, select: { isSmart: true } });
  if (!album) throw new AlbumNotFoundError();
  if (album.isSmart) throw new SmartAlbumMutationError("cannot add photos to a smart album");
  // Only link photos that belong to this catalog — never another catalog's ids.
  const owned = await db.photo.findMany({
    where: { catalogId, ...LIVE_PHOTO, id: { in: photoIds } },
    select: { id: true },
  });
  const result = await db.albumPhoto.createMany({
    data: owned.map(({ id }) => ({ albumId, photoId: id })),
    skipDuplicates: true,
  });
  return result.count;
}

/**
 * Pin `photoId` as the album's cover. Regular albums only; the photo must already
 * be a member. The pin is honored by `listAlbumSummaries` only while the photo
 * stays a member (see the membership check there) and is eager-cleared on removal.
 */
export async function setAlbumCover(catalogId: string, albumId: string, photoId: string, db: Db = prisma): Promise<void> {
  const album = await db.album.findFirst({ where: { id: albumId, catalogId }, select: { isSmart: true } });
  if (!album) throw new AlbumNotFoundError();
  if (album.isSmart) throw new SmartAlbumMutationError("cannot set a cover on a smart album");
  const member = await db.albumPhoto.findUnique({
    where: { albumId_photoId: { albumId, photoId } },
    select: { photoId: true },
  });
  if (!member) throw new PhotoNotInAlbumError();
  await db.album.update({ where: { id: albumId }, data: { coverPhotoId: photoId } });
}

export async function removePhotosFromAlbum(
  catalogId: string,
  albumId: string,
  photoIds: string[],
  db: Db = prisma,
): Promise<number> {
  const album = await db.album.findFirst({ where: { id: albumId, catalogId }, select: { isSmart: true } });
  if (!album) throw new AlbumNotFoundError();
  if (album.isSmart) throw new SmartAlbumMutationError("cannot remove photos from a smart album");
  const result = await db.albumPhoto.deleteMany({
    where: { albumId, photoId: { in: photoIds } },
  });
  await db.album.updateMany({
    where: { id: albumId, coverPhotoId: { in: photoIds } },
    data: { coverPhotoId: null },
  });
  return result.count;
}
