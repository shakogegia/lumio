import { type Prisma, type PrismaClient, type Folder, prisma, folderPhotoWhere, toFolderDTO } from "@lumio/db";
import {
  monthRange,
  type AlbumSummaryDTO,
  type CreateFolderInput,
  type FolderContentsDTO,
  type FolderDTO,
  type FolderSummaryDTO,
  type PhotosPage,
  type PhotosQuery,
  type SmartAlbumRules,
} from "@lumio/shared";
import { PHOTO_ORDER } from "@/lib/photo-order";
import { albumSummary } from "@/lib/albums-service";
import { collectDescendantFolderIds, folderBreadcrumbs } from "@/lib/folder-tree";
import { listPhotosForWhere } from "@/lib/photos-service";

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

/** Recursive summary (counts + preview ids) for one folder. */
async function folderSummary(
  catalogId: string,
  folder: Folder,
  allFolders: Folder[],
  allAlbums: AlbumLite[],
  now: Date,
  db: Db,
): Promise<FolderSummaryDTO> {
  const descendantIds = new Set(collectDescendantFolderIds(allFolders, folder.id));
  const { regularAlbumIds, smartAlbums } = albumsForSubtree(allAlbums, descendantIds);
  const childFolderCount = allFolders.filter((f) => f.parentId === folder.id).length;
  const scopedWhere = folderPhotoWhere({ regularAlbumIds, smartAlbums }, now);
  const where = { catalogId, ...scopedWhere };
  const [totalPhotoCount, previews] = await Promise.all([
    db.photo.count({ where }),
    db.photo.findMany({ where, orderBy: PHOTO_ORDER, take: 4, select: { id: true } }),
  ]);
  return {
    ...toFolderDTO(folder),
    childFolderCount,
    albumCount: regularAlbumIds.length + smartAlbums.length,
    totalPhotoCount,
    previewPhotoIds: previews.map((p) => p.id),
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
  const [allFolders, allAlbums] = await Promise.all([
    db.folder.findMany({ where: { catalogId } }),
    db.album.findMany({ where: { catalogId } }),
  ]);

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
    directChildFolders.map((child) => folderSummary(catalogId, child, allFolders, allAlbums as AlbumLite[], now, db)),
  );
  subfolders.sort((a, b) => a.name.localeCompare(b.name));

  const directAlbums = allAlbums.filter((a) => a.folderId === folderId);
  const albums: AlbumSummaryDTO[] = await Promise.all(directAlbums.map((a) => albumSummary(catalogId, a, db, now)));

  // Recursive deduplicated photo count of the viewed folder (for the header subtitle).
  let currentPhotoCount: number | null = null;
  if (folderId !== null) {
    const descendantIds = new Set(collectDescendantFolderIds(allFolders, folderId));
    const { regularAlbumIds, smartAlbums } = albumsForSubtree(allAlbums as AlbumLite[], descendantIds);
    const scopedWhere = folderPhotoWhere({ regularAlbumIds, smartAlbums }, now);
    currentPhotoCount = await db.photo.count({ where: { catalogId, ...scopedWhere } });
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
  const allAlbums = await db.album.findMany({
    where: { catalogId },
    select: { id: true, isSmart: true, rules: true, folderId: true },
  });
  const { regularAlbumIds, smartAlbums } = albumsForSubtree(allAlbums as AlbumLite[], descendantIds);
  const scopedWhere = folderPhotoWhere({ regularAlbumIds, smartAlbums }, now);
  const { limit, offset, sort, month } = params;
  // listPhotosForWhere adds catalogId at the top level; AND the month range alongside scopedWhere.
  const innerWhere: Prisma.PhotoWhereInput = month
    ? { AND: [scopedWhere, { sortDate: monthRange(month) }] }
    : scopedWhere;
  return listPhotosForWhere(catalogId, innerWhere, { limit, offset, sort }, db);
}
