import { isSupportedImage } from "@lumio/shared";

/** Join a child name under a catalog-relative parent ("" = catalog root). */
export function joinRel(parentRel: string, name: string): string {
  return parentRel ? `${parentRel}/${name}` : name;
}

export interface FsCrumb {
  name: string;
  /** Catalog-relative path of this crumb; "" = the catalog root. */
  rel: string;
}

/** Clickable breadcrumb trail for a catalog-relative path; root is "Library". */
export function catalogBreadcrumbs(rel: string): FsCrumb[] {
  const crumbs: FsCrumb[] = [{ name: "Library", rel: "" }];
  const clean = rel.replace(/^\/+|\/+$/g, "");
  if (!clean) return crumbs;
  let acc = "";
  for (const part of clean.split("/")) {
    if (!part) continue;
    acc = joinRel(acc, part);
    crumbs.push({ name: part, rel: acc });
  }
  return crumbs;
}

export interface RawEntry {
  name: string;
  isDirectory: boolean;
  size: number;
  mtimeMs: number;
}

export interface DirChildCounts {
  /** Number of immediate subfolders inside this folder. */
  folderCount: number;
  /** Number of immediate files inside this folder. */
  fileCount: number;
}

export interface CatalogDirChild extends DirChildCounts {
  name: string;
  rel: string;
  mtimeMs: number;
}

export interface CatalogFileChild {
  name: string;
  rel: string;
  size: number;
  mtimeMs: number;
  isImage: boolean;
  /** Set when this file is an indexed photo (opens in the lightbox). */
  photoId: string | null;
}

export interface CatalogListing {
  rel: string;
  dirs: CatalogDirChild[];
  files: CatalogFileChild[];
}

function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name);
}

/** Pure assembly of a directory listing (no IO). `dirCounts`, keyed by a child's
 *  rel path, supplies each subfolder's immediate folder/file counts (0/0 if absent). */
export function buildCatalogListing(
  rel: string,
  entries: RawEntry[],
  photoIdByRel: Map<string, string>,
  dirCounts?: Map<string, DirChildCounts>,
): CatalogListing {
  const dirs = entries
    .filter((e) => e.isDirectory)
    .map((e) => {
      const childRel = joinRel(rel, e.name);
      const counts = dirCounts?.get(childRel);
      return {
        name: e.name,
        rel: childRel,
        mtimeMs: e.mtimeMs,
        folderCount: counts?.folderCount ?? 0,
        fileCount: counts?.fileCount ?? 0,
      };
    })
    .sort(byName);
  const files = entries
    .filter((e) => !e.isDirectory)
    .map((e) => {
      const childRel = joinRel(rel, e.name);
      return {
        name: e.name,
        rel: childRel,
        size: e.size,
        mtimeMs: e.mtimeMs,
        isImage: isSupportedImage(e.name),
        photoId: photoIdByRel.get(childRel) ?? null,
      };
    })
    .sort(byName);
  return { rel, dirs, files };
}

export type FolderSortField = "name" | "date";
export type FolderSortDir = "asc" | "desc";
export interface FolderSort {
  field: FolderSortField;
  dir: FolderSortDir;
}

/** Sort a copy of `items` by name (locale-aware) or modified date, asc/desc.
 *  Ties on date fall back to name so the order stays stable. Pure. */
export function sortFolderItems<T extends { name: string; mtimeMs: number }>(
  items: T[],
  sort: FolderSort,
): T[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    const cmp =
      sort.field === "date"
        ? a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name)
        : a.name.localeCompare(b.name);
    return sign * cmp;
  });
}

/** Case-insensitive substring filter on `name`; a blank query returns all. Pure. */
export function filterByName<T extends { name: string }>(items: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((i) => i.name.toLowerCase().includes(q));
}

/** Human label for a folder's immediate children, e.g. "3 folders, 12 files"
 *  (zero parts omitted; "Empty" when the folder has neither). */
export function folderCountLabel(folderCount: number, fileCount: number): string {
  const parts: string[] = [];
  if (folderCount > 0) parts.push(`${folderCount} ${folderCount === 1 ? "folder" : "folders"}`);
  if (fileCount > 0) parts.push(`${fileCount} ${fileCount === 1 ? "file" : "files"}`);
  return parts.length > 0 ? parts.join(", ") : "Empty";
}
