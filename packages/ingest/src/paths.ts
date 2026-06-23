import path from "node:path";

/** The three per-catalog rendition cache directories, nested under a cache root.
 *  Structurally identical to RegenerateDeps (regenerate.ts) so it can be passed
 *  straight to regenerateRenditions. */
export interface CatalogCacheDirs {
  thumbnailsDir: string;
  displaysDir: string;
  editedDisplaysDir: string;
}

/** Per-catalog rendition cache directories under `cacheRoot`. Env-free — the caller
 *  supplies the resolved cache root — so this stays a pure layout helper and is the
 *  single source of the cache directory convention. */
export function catalogCacheDirs(cacheRoot: string, catalogId: string): CatalogCacheDirs {
  const base = path.join(cacheRoot, catalogId);
  return {
    thumbnailsDir: path.join(base, "thumbnails"),
    displaysDir: path.join(base, "displays"),
    editedDisplaysDir: path.join(base, "displays-edited"),
  };
}

/** Absolute path of a photo's thumbnail rendition. */
export function thumbnailPath(cacheRoot: string, catalogId: string, id: string): string {
  return path.join(catalogCacheDirs(cacheRoot, catalogId).thumbnailsDir, `${id}.webp`);
}

/** Absolute path of a photo's edit-free base display rendition. */
export function displayPath(cacheRoot: string, catalogId: string, id: string): string {
  return path.join(catalogCacheDirs(cacheRoot, catalogId).displaysDir, `${id}.webp`);
}

/** Absolute path of a photo's baked edited-display rendition. */
export function editedDisplayPath(cacheRoot: string, catalogId: string, id: string): string {
  return path.join(catalogCacheDirs(cacheRoot, catalogId).editedDisplaysDir, `${id}.webp`);
}
