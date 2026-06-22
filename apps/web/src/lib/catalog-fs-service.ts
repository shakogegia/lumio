import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { isSupportedImage } from "@lumio/shared";
import { prisma } from "@lumio/db";
import { originalPath } from "@/lib/paths";
import {
  buildCatalogListing,
  joinRel,
  type CatalogDirChild,
  type CatalogFileChild,
  type CatalogListing,
  type DirChildCounts,
  type RawEntry,
} from "@/lib/catalog-fs";

/** Injectable IO so the assembly is testable without a real FS/DB. */
export interface CatalogDirDeps {
  readdir: (absPath: string) => Promise<{ name: string; isDirectory: () => boolean }[]>;
  stat: (absPath: string) => Promise<{ size: number; mtimeMs: number }>;
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
      let mtimeMs = 0;
      try {
        const st = await deps.stat(path.join(absDir, d.name));
        mtimeMs = st.mtimeMs;
        if (!isDirectory) size = st.size;
      } catch {
        // Unreadable entry: leave size/mtime at 0 rather than failing the listing.
      }
      return { name: d.name, isDirectory, size, mtimeMs };
    }),
  );
  const imageRels = raw
    .filter((e) => !e.isDirectory && isSupportedImage(e.name))
    .map((e) => joinRel(rel, e.name));
  const photos = imageRels.length
    ? await deps.findIndexedPhotos(catalog.id, imageRels)
    : [];
  const photoIdByRel = new Map(photos.map((p) => [p.path, p.id]));

  // One extra readdir per subfolder to show its immediate folder/file counts.
  // Permission/read errors fall back to 0/0 rather than failing the whole listing.
  const dirCounts = new Map<string, DirChildCounts>();
  await Promise.all(
    raw
      .filter((e) => e.isDirectory)
      .map(async (e) => {
        const childRel = joinRel(rel, e.name);
        try {
          const children = await deps.readdir(path.join(absDir, e.name));
          let folderCount = 0;
          let fileCount = 0;
          for (const c of children) {
            if (c.isDirectory()) folderCount++;
            else fileCount++;
          }
          dirCounts.set(childRel, { folderCount, fileCount });
        } catch {
          dirCounts.set(childRel, { folderCount: 0, fileCount: 0 });
        }
      }),
  );

  return buildCatalogListing(rel, raw, photoIdByRel, dirCounts);
}

export interface CatalogSearchResult {
  dirs: CatalogDirChild[];
  files: CatalogFileChild[];
  /** True when a scan/result cap was hit, so matches may be incomplete. */
  truncated: boolean;
}

const SEARCH_MAX_RESULTS = 300;
const SEARCH_MAX_SCANNED = 10000;

/**
 * Recursively find folders/files under `baseRel` whose name contains `query`
 * (case-insensitive). Bounded to the catalog dir (via originalPath) and capped
 * at SEARCH_MAX_RESULTS matches / SEARCH_MAX_SCANNED entries scanned (sets
 * `truncated`). Matched dirs carry immediate counts; matched indexed photos
 * carry a `photoId`. Each result's `rel` is the full catalog-relative path.
 */
export async function searchCatalogTree(
  catalog: { id: string; path: string },
  baseRel: string,
  query: string,
  deps: CatalogDirDeps = defaultDeps,
): Promise<CatalogSearchResult> {
  const q = query.trim().toLowerCase();
  if (!q) return { dirs: [], files: [], truncated: false };
  const baseAbs = originalPath(catalog, baseRel); // throws on traversal

  const dirHits: { name: string; rel: string; abs: string }[] = [];
  const fileHits: { name: string; rel: string; abs: string }[] = [];
  let scanned = 0;
  let truncated = false;

  const stack: { abs: string; rel: string }[] = [{ abs: baseAbs, rel: baseRel }];
  while (stack.length > 0) {
    if (dirHits.length + fileHits.length >= SEARCH_MAX_RESULTS || scanned >= SEARCH_MAX_SCANNED) {
      truncated = true;
      break;
    }
    const cur = stack.pop() as { abs: string; rel: string };
    let entries: { name: string; isDirectory: () => boolean }[];
    try {
      entries = await deps.readdir(cur.abs);
    } catch {
      continue; // unreadable dir — skip it
    }
    for (const e of entries) {
      scanned++;
      const childRel = joinRel(cur.rel, e.name);
      const childAbs = path.join(cur.abs, e.name);
      if (e.isDirectory()) {
        stack.push({ abs: childAbs, rel: childRel });
        if (e.name.toLowerCase().includes(q)) {
          dirHits.push({ name: e.name, rel: childRel, abs: childAbs });
        }
      } else if (e.name.toLowerCase().includes(q)) {
        fileHits.push({ name: e.name, rel: childRel, abs: childAbs });
      }
    }
  }

  // Enrich dir hits with mtime + immediate counts.
  const dirs: CatalogDirChild[] = await Promise.all(
    dirHits.map(async (d) => {
      let mtimeMs = 0;
      let folderCount = 0;
      let fileCount = 0;
      try {
        mtimeMs = (await deps.stat(d.abs)).mtimeMs;
      } catch {
        mtimeMs = 0;
      }
      try {
        for (const k of await deps.readdir(d.abs)) {
          if (k.isDirectory()) folderCount++;
          else fileCount++;
        }
      } catch {
        folderCount = 0;
        fileCount = 0;
      }
      return { name: d.name, rel: d.rel, mtimeMs, folderCount, fileCount };
    }),
  );

  // Enrich file hits with size + mtime, and link indexed photos.
  const stats = await Promise.all(
    fileHits.map(async (f) => {
      try {
        const st = await deps.stat(f.abs);
        return { size: st.size, mtimeMs: st.mtimeMs };
      } catch {
        return { size: 0, mtimeMs: 0 };
      }
    }),
  );
  const imageRels = fileHits.filter((f) => isSupportedImage(f.name)).map((f) => f.rel);
  const photos = imageRels.length ? await deps.findIndexedPhotos(catalog.id, imageRels) : [];
  const photoIdByRel = new Map(photos.map((p) => [p.path, p.id]));
  const files: CatalogFileChild[] = fileHits.map((f, i) => ({
    name: f.name,
    rel: f.rel,
    size: stats[i].size,
    mtimeMs: stats[i].mtimeMs,
    isImage: isSupportedImage(f.name),
    photoId: photoIdByRel.get(f.rel) ?? null,
  }));

  return { dirs, files, truncated };
}
