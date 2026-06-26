import { type Prisma, type PrismaClient, type Folder, getCatalogSchema, prisma, folderPhotoWhere, toFolderDTO } from "@lumio/db";
import {
  buildSearchRegistry,
  monthRange,
  type AlbumSummaryDTO,
  type CreateFolderInput,
  type FolderContentsDTO,
  type FolderDTO,
  type FolderSummaryDTO,
  type PhotosPage,
  type PhotosQuery,
  type SearchRegistry,
  type SmartAlbumRules,
} from "@lumio/shared";
import { PHOTO_ORDER } from "@/lib/photo-order";
import { albumCoverMap, albumSummary } from "@/lib/server/albums-service";
import { collectDescendantFolderIds, folderBreadcrumbs } from "@/lib/folder-tree";
import { listPhotosForWhere } from "@/lib/server/photos-service";
import { LIVE_PHOTO } from "@/lib/server/photo-filters";

type Db = Pick<PrismaClient, "folder" | "album" | "albumPhoto" | "photo" | "$transaction">;

/** Album fields needed to split a subtree into regular vs smart membership. */
type AlbumLite = {
  id: string;
  isSmart: boolean;
  rules: Prisma.JsonValue | null;
  folderId: string | null;
};

export class FolderNotFoundError extends Error {
  constructor(message = "Folder not found") {
    super(message);
  }
}
export class FolderCycleError extends Error {
  constructor(message = "Cannot move a folder into itself or a descendant") {
    super(message);
  }
}

/** Partition the albums whose folder is in `descendantIds` into regular ids and smart rule-sets. */
function albumsForSubtree(
  allAlbums: AlbumLite[],
  descendantIds: Set<string>,
): { regularAlbumIds: string[]; smartAlbums: { rules: SmartAlbumRules }[] } {
  const regularAlbumIds: string[] = [];
  const smartAlbums: { rules: SmartAlbumRules }[] = [];
  for (const a of allAlbums) {
    if (a.folderId === null || !descendantIds.has(a.folderId)) continue;
    if (a.isSmart && a.rules) smartAlbums.push({ rules: a.rules as unknown as SmartAlbumRules });
    else regularAlbumIds.push(a.id);
  }
  return { regularAlbumIds, smartAlbums };
}

/** Albums in a folder's subtree, ordered for the preview mosaic: direct children
 *  first, then deeper descendants. The incoming `allAlbums` order (catalog
 *  createdAt-asc) is preserved as the within-tier tiebreak. */
function subtreeAlbumsForPreview(allAlbums: AlbumLite[], folderId: string, descendantIds: Set<string>): AlbumLite[] {
  const direct: AlbumLite[] = [];
  const nested: AlbumLite[] = [];
  for (const a of allAlbums) {
    if (a.folderId === null || !descendantIds.has(a.folderId)) continue;
    if (a.folderId === folderId) direct.push(a);
    else nested.push(a);
  }
  return [...direct, ...nested];
}

/** Recursive summary (counts + preview ids) for one folder. The preview mosaic
 *  leads with the inner albums' covers (direct children first), then tops up any
 *  remaining cells with the most-recent subtree photos. `coverMap` carries the
 *  catalog's album covers so they are resolved once, not per folder. */
async function folderSummary(
  catalogId: string,
  folder: Folder,
  allFolders: Folder[],
  allAlbums: AlbumLite[],
  coverMap: Map<string, string | null>,
  now: Date,
  registry: SearchRegistry,
  db: Db,
): Promise<FolderSummaryDTO> {
  const descendantIds = new Set(collectDescendantFolderIds(allFolders, folder.id));
  const { regularAlbumIds, smartAlbums } = albumsForSubtree(allAlbums, descendantIds);
  const childFolderCount = allFolders.filter((f) => f.parentId === folder.id).length;
  const scopedWhere = folderPhotoWhere({ regularAlbumIds, smartAlbums }, now, registry);
  const where = { catalogId, ...LIVE_PHOTO, ...scopedWhere };

  // Album covers first (direct children before nested), deduped, up to 4.
  const previewPhotoIds: string[] = [];
  const seen = new Set<string>();
  for (const album of subtreeAlbumsForPreview(allAlbums, folder.id, descendantIds)) {
    const cover = coverMap.get(album.id);
    if (!cover || seen.has(cover)) continue;
    previewPhotoIds.push(cover);
    seen.add(cover);
    if (previewPhotoIds.length === 4) break;
  }

  const fillNeeded = 4 - previewPhotoIds.length;
  const [totalPhotoCount, fill] = await Promise.all([
    db.photo.count({ where }),
    fillNeeded > 0
      ? db.photo.findMany({
          where: seen.size ? { ...where, id: { notIn: [...seen] } } : where,
          orderBy: PHOTO_ORDER,
          take: fillNeeded,
          select: { id: true },
        })
      : Promise.resolve<{ id: string }[]>([]),
  ]);
  // Top up the remaining mosaic cells with recent photos, skipping any cover already shown.
  for (const p of fill) {
    if (previewPhotoIds.length === 4) break;
    if (seen.has(p.id)) continue;
    previewPhotoIds.push(p.id);
    seen.add(p.id);
  }

  return {
    ...toFolderDTO(folder),
    childFolderCount,
    albumCount: regularAlbumIds.length + smartAlbums.length,
    totalPhotoCount,
    previewPhotoIds,
  };
}

export async function createFolder(catalogId: string, input: CreateFolderInput, db: Db = prisma): Promise<FolderDTO> {
  if (input.parentId) {
    const parent = await db.folder.findFirst({ where: { id: input.parentId, catalogId }, select: { id: true } });
    if (!parent) throw new FolderNotFoundError();
  }
  const row = await db.folder.create({ data: { name: input.name, parentId: input.parentId ?? null, catalogId } });
  return toFolderDTO(row);
}

export async function getFolder(catalogId: string, id: string, db: Db = prisma): Promise<FolderDTO | null> {
  const row = await db.folder.findFirst({ where: { id, catalogId } });
  return row ? toFolderDTO(row) : null;
}

export async function renameFolder(catalogId: string, id: string, name: string, db: Db = prisma): Promise<FolderDTO> {
  const found = await db.folder.findFirst({ where: { id, catalogId }, select: { id: true } });
  if (!found) throw new FolderNotFoundError();
  const row = await db.folder.update({ where: { id }, data: { name } });
  return toFolderDTO(row);
}

export async function listFolderContents(
  catalogId: string,
  folderId: string | null,
  db: Db = prisma,
): Promise<FolderContentsDTO | null> {
  const now = new Date();
  const [allFolders, allAlbums, registry] = await Promise.all([
    db.folder.findMany({ where: { catalogId } }),
    // createdAt-asc is the canonical album order (matches listAlbumSummaries); it
    // becomes the within-tier tiebreak for folder-preview album covers.
    db.album.findMany({ where: { catalogId }, orderBy: { createdAt: "asc" } }),
    // Per-catalog field registry: descendant smart albums may filter on custom
    // metadata fields, which only resolve through it (else `unsupported rule`).
    getCatalogSchema(catalogId).then(buildSearchRegistry),
  ]);
  // Resolve every album's cover once so each folder preview reuses them.
  const coverMap = await albumCoverMap(catalogId, allAlbums, db, now);

  let folder: FolderDTO | null = null;
  let breadcrumbs: FolderDTO[] = [];
  if (folderId !== null) {
    const self = allFolders.find((f) => f.id === folderId);
    if (!self) return null;
    folder = toFolderDTO(self);
    const byId = new Map(allFolders.map((f) => [f.id, f]));
    breadcrumbs = folderBreadcrumbs(allFolders, folderId).map((f) => toFolderDTO(byId.get(f.id) as Folder));
  }

  const directChildFolders = allFolders.filter((f) => f.parentId === folderId);
  const subfolders = await Promise.all(
    directChildFolders.map((child) =>
      folderSummary(catalogId, child, allFolders, allAlbums as AlbumLite[], coverMap, now, registry, db),
    ),
  );
  subfolders.sort((a, b) => a.name.localeCompare(b.name));

  const directAlbums = allAlbums.filter((a) => a.folderId === folderId);
  const albums: AlbumSummaryDTO[] = await Promise.all(directAlbums.map((a) => albumSummary(catalogId, a, db, now)));
  albums.sort((a, b) => a.name.localeCompare(b.name));

  // Recursive deduplicated photo count of the viewed folder (for the header subtitle).
  let currentPhotoCount: number | null = null;
  if (folderId !== null) {
    const descendantIds = new Set(collectDescendantFolderIds(allFolders, folderId));
    const { regularAlbumIds, smartAlbums } = albumsForSubtree(allAlbums as AlbumLite[], descendantIds);
    const scopedWhere = folderPhotoWhere({ regularAlbumIds, smartAlbums }, now, registry);
    currentPhotoCount = await db.photo.count({ where: { catalogId, ...LIVE_PHOTO, ...scopedWhere } });
  }

  return { folder, breadcrumbs, subfolders, albums, currentPhotoCount };
}

export async function moveItems(
  catalogId: string,
  input: { folderIds?: string[]; albumIds?: string[]; targetFolderId: string | null },
  db: Db = prisma,
): Promise<number> {
  const folderIds = input.folderIds ?? [];
  const albumIds = input.albumIds ?? [];
  const target = input.targetFolderId;

  const allFolders = await db.folder.findMany({ where: { catalogId }, select: { id: true, parentId: true } });
  const known = new Set(allFolders.map((f) => f.id));

  if (target !== null && !known.has(target)) throw new FolderNotFoundError();

  for (const fid of folderIds) {
    if (!known.has(fid)) throw new FolderNotFoundError();
    if (target !== null) {
      const descendants = new Set(collectDescendantFolderIds(allFolders, fid)); // includes fid itself
      if (descendants.has(target)) throw new FolderCycleError();
    }
  }

  const ops: Prisma.PrismaPromise<{ count: number }>[] = [];
  if (folderIds.length > 0) {
    ops.push(db.folder.updateMany({ where: { catalogId, id: { in: folderIds } }, data: { parentId: target } }));
  }
  if (albumIds.length > 0) {
    ops.push(db.album.updateMany({ where: { catalogId, id: { in: albumIds } }, data: { folderId: target } }));
  }
  if (ops.length === 0) return 0;
  const results = await db.$transaction(ops);
  return results.reduce((sum, r) => sum + r.count, 0);
}

export async function deleteFolder(
  catalogId: string,
  id: string,
  mode: "reparent" | "cascade",
  db: Db = prisma,
): Promise<void> {
  if (mode === "reparent") {
    const folder = await db.folder.findFirst({ where: { id, catalogId }, select: { parentId: true } });
    if (!folder) throw new FolderNotFoundError();
    await db.$transaction([
      db.folder.updateMany({ where: { parentId: id }, data: { parentId: folder.parentId } }),
      db.album.updateMany({ where: { folderId: id }, data: { folderId: folder.parentId } }),
      db.folder.delete({ where: { id } }),
    ]);
    return;
  }
  // cascade: delete the whole subtree (albums first so the FK allows the folder deletes).
  const allFolders = await db.folder.findMany({ where: { catalogId }, select: { id: true, parentId: true } });
  if (!allFolders.some((f) => f.id === id)) throw new FolderNotFoundError();
  const ids = collectDescendantFolderIds(allFolders, id);
  await db.$transaction([
    db.album.deleteMany({ where: { catalogId, folderId: { in: ids } } }),
    db.folder.deleteMany({ where: { catalogId, id: { in: ids } } }),
  ]);
}

export async function listAllFolders(catalogId: string, db: Db = prisma): Promise<FolderDTO[]> {
  const rows = await db.folder.findMany({ where: { catalogId }, orderBy: { name: "asc" } });
  return rows.map(toFolderDTO);
}

export async function listFolderPhotos(
  catalogId: string,
  id: string,
  params: PhotosQuery,
  db: Db = prisma,
): Promise<PhotosPage | null> {
  const now = new Date();
  const allFolders = await db.folder.findMany({ where: { catalogId }, select: { id: true, parentId: true } });
  if (!allFolders.some((f) => f.id === id)) return null;
  const descendantIds = new Set(collectDescendantFolderIds(allFolders, id));
  const [allAlbums, registry] = await Promise.all([
    db.album.findMany({
      where: { catalogId },
      select: { id: true, isSmart: true, rules: true, folderId: true },
    }),
    // Needed so descendant smart albums filtering on custom fields resolve.
    getCatalogSchema(catalogId).then(buildSearchRegistry),
  ]);
  const { regularAlbumIds, smartAlbums } = albumsForSubtree(allAlbums as AlbumLite[], descendantIds);
  const scopedWhere = folderPhotoWhere({ regularAlbumIds, smartAlbums }, now, registry);
  const { limit, offset, sort, month } = params;
  // listPhotosForWhere adds catalogId at the top level; AND the month range alongside scopedWhere.
  const innerWhere: Prisma.PhotoWhereInput = month
    ? { AND: [scopedWhere, { sortDate: monthRange(month) }] }
    : scopedWhere;
  return listPhotosForWhere(catalogId, innerWhere, { limit, offset, sort }, db);
}
