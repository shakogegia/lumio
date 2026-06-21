import { type Prisma, type PrismaClient, type Folder, prisma, folderPhotoWhere, toFolderDTO, toPhotoDTO } from "@lumio/db";
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
import { PHOTO_ORDER, photoOrderBy } from "@/lib/photo-order";
import { albumSummary } from "@/lib/albums-service";
import { collectDescendantFolderIds, folderBreadcrumbs } from "@/lib/folder-tree";

type Db = Pick<PrismaClient, "folder" | "album" | "albumPhoto" | "photo" | "$transaction">;

/** Album fields needed to split a subtree into regular vs smart membership. */
type AlbumLite = {
  id: string;
  isSmart: boolean;
  rules: Prisma.JsonValue | null;
  folderId: string | null;
};

export class FolderNotFoundError extends Error {}
export class FolderCycleError extends Error {}

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
  folder: Folder,
  allFolders: Folder[],
  allAlbums: AlbumLite[],
  now: Date,
  db: Db,
): Promise<FolderSummaryDTO> {
  const descendantIds = new Set(collectDescendantFolderIds(allFolders, folder.id));
  const { regularAlbumIds, smartAlbums } = albumsForSubtree(allAlbums, descendantIds);
  const childFolderCount = allFolders.filter((f) => f.parentId === folder.id).length;
  const where = folderPhotoWhere({ regularAlbumIds, smartAlbums }, now);
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

export async function createFolder(input: CreateFolderInput, db: Db = prisma): Promise<FolderDTO> {
  if (input.parentId) {
    const parent = await db.folder.findUnique({ where: { id: input.parentId }, select: { id: true } });
    if (!parent) throw new FolderNotFoundError();
  }
  const row = await db.folder.create({ data: { name: input.name, parentId: input.parentId ?? null } });
  return toFolderDTO(row);
}

export async function getFolder(id: string, db: Db = prisma): Promise<FolderDTO | null> {
  const row = await db.folder.findUnique({ where: { id } });
  return row ? toFolderDTO(row) : null;
}

export async function renameFolder(id: string, name: string, db: Db = prisma): Promise<FolderDTO> {
  const found = await db.folder.findUnique({ where: { id }, select: { id: true } });
  if (!found) throw new FolderNotFoundError();
  const row = await db.folder.update({ where: { id }, data: { name } });
  return toFolderDTO(row);
}

export async function listFolderContents(
  folderId: string | null,
  db: Db = prisma,
): Promise<FolderContentsDTO | null> {
  const now = new Date();
  const [allFolders, allAlbums] = await Promise.all([db.folder.findMany(), db.album.findMany()]);

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
    directChildFolders.map((child) => folderSummary(child, allFolders, allAlbums as AlbumLite[], now, db)),
  );
  subfolders.sort((a, b) => a.name.localeCompare(b.name));

  const directAlbums = allAlbums.filter((a) => a.folderId === folderId);
  const albums: AlbumSummaryDTO[] = await Promise.all(directAlbums.map((a) => albumSummary(a, db, now)));

  return { folder, breadcrumbs, subfolders, albums };
}

export async function moveItems(
  input: { folderIds?: string[]; albumIds?: string[]; targetFolderId: string | null },
  db: Db = prisma,
): Promise<number> {
  const folderIds = input.folderIds ?? [];
  const albumIds = input.albumIds ?? [];
  const target = input.targetFolderId;

  const allFolders = await db.folder.findMany({ select: { id: true, parentId: true } });
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
    ops.push(db.folder.updateMany({ where: { id: { in: folderIds } }, data: { parentId: target } }));
  }
  if (albumIds.length > 0) {
    ops.push(db.album.updateMany({ where: { id: { in: albumIds } }, data: { folderId: target } }));
  }
  if (ops.length === 0) return 0;
  const results = await db.$transaction(ops);
  return results.reduce((sum, r) => sum + r.count, 0);
}

export async function deleteFolder(
  id: string,
  mode: "reparent" | "cascade",
  db: Db = prisma,
): Promise<void> {
  if (mode === "reparent") {
    const folder = await db.folder.findUnique({ where: { id }, select: { parentId: true } });
    if (!folder) throw new FolderNotFoundError();
    await db.$transaction([
      db.folder.updateMany({ where: { parentId: id }, data: { parentId: folder.parentId } }),
      db.album.updateMany({ where: { folderId: id }, data: { folderId: folder.parentId } }),
      db.folder.delete({ where: { id } }),
    ]);
    return;
  }
  // cascade: delete the whole subtree (albums first so the FK allows the folder deletes).
  const allFolders = await db.folder.findMany({ select: { id: true, parentId: true } });
  if (!allFolders.some((f) => f.id === id)) throw new FolderNotFoundError();
  const ids = collectDescendantFolderIds(allFolders, id);
  await db.$transaction([
    db.album.deleteMany({ where: { folderId: { in: ids } } }),
    db.folder.deleteMany({ where: { id: { in: ids } } }),
  ]);
}

export async function listAllFolders(db: Db = prisma): Promise<FolderDTO[]> {
  const rows = await db.folder.findMany({ orderBy: { name: "asc" } });
  return rows.map(toFolderDTO);
}

export async function listFolderPhotos(
  id: string,
  params: PhotosQuery,
  db: Db = prisma,
): Promise<PhotosPage | null> {
  const now = new Date();
  const allFolders = await db.folder.findMany({ select: { id: true, parentId: true } });
  if (!allFolders.some((f) => f.id === id)) return null;
  const descendantIds = new Set(collectDescendantFolderIds(allFolders, id));
  const allAlbums = await db.album.findMany({
    select: { id: true, isSmart: true, rules: true, folderId: true },
  });
  const { regularAlbumIds, smartAlbums } = albumsForSubtree(allAlbums as AlbumLite[], descendantIds);
  const scoped = folderPhotoWhere({ regularAlbumIds, smartAlbums }, now);
  const { limit, offset, sort, month } = params;
  const where = month ? { AND: [scoped, { sortDate: monthRange(month) }] } : scoped;
  const [rows, total] = await Promise.all([
    db.photo.findMany({ where, skip: offset, take: limit, orderBy: photoOrderBy(sort) }),
    db.photo.count({ where }),
  ]);
  return { items: rows.map(toPhotoDTO), total };
}
