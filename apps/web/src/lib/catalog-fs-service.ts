import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { isSupportedImage } from "@lumio/shared";
import { prisma } from "@lumio/db";
import { originalPath } from "@/lib/paths";
import {
  buildCatalogListing,
  joinRel,
  type CatalogListing,
  type RawEntry,
} from "@/lib/catalog-fs";

/** Injectable IO so the assembly is testable without a real FS/DB. */
export interface CatalogDirDeps {
  readdir: (absPath: string) => Promise<{ name: string; isDirectory: () => boolean }[]>;
  stat: (absPath: string) => Promise<{ size: number }>;
  findIndexedPhotos: (
    catalogId: string,
    rels: string[],
  ) => Promise<{ id: string; path: string }[]>;
}

const defaultDeps: CatalogDirDeps = {
  readdir: (absPath) => readdir(absPath, { withFileTypes: true }),
  stat: (absPath) => stat(absPath),
  findIndexedPhotos: (catalogId, rels) =>
    prisma.photo.findMany({
      where: { catalogId, path: { in: rels } },
      select: { id: true, path: true },
    }),
};

/**
 * List one directory inside a catalog. `rel` is catalog-relative ("" = root).
 * Throws if `rel` escapes the catalog (via originalPath) or the dir is missing.
 * Indexed photos (matched by relative path) carry a `photoId`.
 */
export async function readCatalogDir(
  catalog: { id: string; path: string },
  rel: string,
  deps: CatalogDirDeps = defaultDeps,
): Promise<CatalogListing> {
  const absDir = originalPath(catalog, rel); // throws on traversal
  const dirents = await deps.readdir(absDir);
  const raw: RawEntry[] = await Promise.all(
    dirents.map(async (d) => {
      const isDirectory = d.isDirectory();
      let size = 0;
      if (!isDirectory) {
        try {
          size = (await deps.stat(path.join(absDir, d.name))).size;
        } catch {
          size = 0;
        }
      }
      return { name: d.name, isDirectory, size };
    }),
  );
  const imageRels = raw
    .filter((e) => !e.isDirectory && isSupportedImage(e.name))
    .map((e) => joinRel(rel, e.name));
  const photos = imageRels.length
    ? await deps.findIndexedPhotos(catalog.id, imageRels)
    : [];
  const photoIdByRel = new Map(photos.map((p) => [p.path, p.id]));
  return buildCatalogListing(rel, raw, photoIdByRel);
}
