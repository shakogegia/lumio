import { readdir } from "node:fs/promises";
import { originalPath } from "@/lib/paths";
import { joinRel } from "@/lib/catalog-fs";
import { type Prisma, prisma } from "@lumio/db";
import { PHOTO_ORDER } from "@/lib/photo-order";

export interface FolderSummary {
  name: string;
  rel: string;
  /** Immediate subdirectories on disk (incl. empty ones). */
  subfolderCount: number;
  /** Photos in this folder's whole subtree (recursive, via dirPath). */
  photoCount: number;
  /** ≤4 cover ids for the subtree, canonical (newest-taken) order. */
  previewPhotoIds: string[];
}

/** Photos in directory `rel` OR any descendant of it (recursive subtree).
 *  `rel` must be a non-empty catalog-relative dir. */
export function subtreeWhere(catalogId: string, rel: string): Prisma.PhotoWhereInput {
  return { catalogId, OR: [{ dirPath: rel }, { dirPath: { startsWith: `${rel}/` } }] };
}

export interface FolderSummaryDeps {
  readdir: (absPath: string) => Promise<{ name: string; isDirectory: () => boolean }[]>;
  countPhotos: (catalogId: string, subtreeRel: string) => Promise<number>;
  previewPhotoIds: (catalogId: string, subtreeRel: string) => Promise<string[]>;
}

const folderSummaryDeps: FolderSummaryDeps = {
  readdir: (absPath) => readdir(absPath, { withFileTypes: true }),
  countPhotos: (catalogId, rel) => prisma.photo.count({ where: subtreeWhere(catalogId, rel) }),
  previewPhotoIds: (catalogId, rel) =>
    prisma.photo
      .findMany({ where: subtreeWhere(catalogId, rel), orderBy: PHOTO_ORDER, take: 4, select: { id: true } })
      .then((rows) => rows.map((r) => r.id)),
};

/** Immediate subdirectories of catalog-relative `rel` ("" = root), each enriched
 *  with a recursive photo count + ≤4 cover ids (from the indexed dirPath column)
 *  and an immediate subfolder count (from the filesystem). Sorted by name. Bounded
 *  to the catalog dir via originalPath (throws on traversal). The DB work is
 *  parallel per subfolder — bounded to one level's fan-out, never a recursive walk. */
export async function listSubfolderSummaries(
  catalog: { id: string; path: string },
  rel: string,
  deps: FolderSummaryDeps = folderSummaryDeps,
): Promise<FolderSummary[]> {
  const absDir = originalPath(catalog, rel); // throws on traversal
  const entries = await deps.readdir(absDir);
  const subdirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, rel: joinRel(rel, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return Promise.all(
    subdirs.map(async (sub) => {
      const [children, photoCount, previewPhotoIds] = await Promise.all([
        deps.readdir(originalPath(catalog, sub.rel)),
        deps.countPhotos(catalog.id, sub.rel),
        deps.previewPhotoIds(catalog.id, sub.rel),
      ]);
      return {
        name: sub.name,
        rel: sub.rel,
        subfolderCount: children.filter((e) => e.isDirectory()).length,
        photoCount,
        previewPhotoIds,
      };
    }),
  );
}
