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
}

export interface CatalogDirChild {
  name: string;
  rel: string;
}

export interface CatalogFileChild {
  name: string;
  rel: string;
  size: number;
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

/** Pure assembly of a directory listing (no IO). */
export function buildCatalogListing(
  rel: string,
  entries: RawEntry[],
  photoIdByRel: Map<string, string>,
): CatalogListing {
  const dirs = entries
    .filter((e) => e.isDirectory)
    .map((e) => ({ name: e.name, rel: joinRel(rel, e.name) }))
    .sort(byName);
  const files = entries
    .filter((e) => !e.isDirectory)
    .map((e) => {
      const childRel = joinRel(rel, e.name);
      return {
        name: e.name,
        rel: childRel,
        size: e.size,
        isImage: isSupportedImage(e.name),
        photoId: photoIdByRel.get(childRel) ?? null,
      };
    })
    .sort(byName);
  return { rel, dirs, files };
}
