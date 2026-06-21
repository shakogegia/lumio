import { type Prisma, type PrismaClient, type Folder, prisma, folderPhotoWhere, toFolderDTO } from "@lumio/db";
import {
  type AlbumSummaryDTO,
  type CreateFolderInput,
  type FolderContentsDTO,
  type FolderDTO,
  type FolderSummaryDTO,
  type SmartAlbumRules,
} from "@lumio/shared";
import { PHOTO_ORDER } from "@/lib/photo-order";
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
