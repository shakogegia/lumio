import { readdir } from "node:fs/promises";
import { originalPath } from "@/lib/paths";
import { joinRel } from "@/lib/catalog-fs";

export interface Subfolder {
  name: string;
  rel: string;
}

export interface SubfolderDeps {
  readdir: (absPath: string) => Promise<{ name: string; isDirectory: () => boolean }[]>;
}

const subfolderDeps: SubfolderDeps = {
  readdir: (absPath) => readdir(absPath, { withFileTypes: true }),
};

/** Immediate subdirectories of catalog-relative `rel` ("" = root), sorted by name.
 *  Bounded to the catalog dir via originalPath (throws on traversal). */
export async function listSubfolders(
  catalog: { id: string; path: string },
  rel: string,
  deps: SubfolderDeps = subfolderDeps,
): Promise<Subfolder[]> {
  const absDir = originalPath(catalog, rel); // throws on traversal
  const entries = await deps.readdir(absDir);
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, rel: joinRel(rel, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
