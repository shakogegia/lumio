import { describe, expect, it } from "vitest";
import {
  readCatalogDir,
  searchCatalogTree,
  listSubfolders,
  type CatalogDirDeps,
  type SubfolderDeps,
} from "./catalog-fs-service.js";

function dirent(name: string, isDir: boolean) {
  return { name, isDirectory: () => isDir };
}

const catalog = { id: "cat1", path: "/media/fam" };

function deps(): CatalogDirDeps {
  return {
    readdir: async () => [dirent("2024", true), dirent("a.jpg", false), dirent("note.txt", false)],
    stat: async (p: string) => ({
      size: p.endsWith("a.jpg") ? 100 : 5,
      mtimeMs: p.endsWith("2024") ? 50 : 0,
    }),
    findIndexedPhotos: async (catalogId, rels) => {
      expect(catalogId).toBe("cat1");
      expect(rels).toContain("a.jpg"); // only image files are queried
      expect(rels).not.toContain("note.txt");
      return [{ id: "p1", path: "a.jpg" }];
    },
  };
}

describe("readCatalogDir", () => {
  it("lists dirs+files at the catalog root and links indexed photos", async () => {
    const listing = await readCatalogDir(catalog, "", deps());
    // The fake readdir returns the same 3 entries for the "2024" subfolder too,
    // so its immediate counts are 1 folder + 2 files.
    expect(listing.dirs).toEqual([
      { name: "2024", rel: "2024", mtimeMs: 50, folderCount: 1, fileCount: 2 },
    ]);
    expect(listing.files.find((f) => f.name === "a.jpg")).toMatchObject({
      photoId: "p1",
      isImage: true,
      size: 100,
    });
    expect(listing.files.find((f) => f.name === "note.txt")).toMatchObject({
      photoId: null,
      isImage: false,
    });
  });

  it("blocks path traversal outside the catalog", async () => {
    await expect(readCatalogDir(catalog, "../secrets", deps())).rejects.toThrow();
  });
});

describe("searchCatalogTree", () => {
  function treeDeps(): CatalogDirDeps {
    const tree: Record<string, { name: string; isDirectory: () => boolean }[]> = {
      "/media/fam": [dirent("2024", true), dirent("readme.txt", false)],
      "/media/fam/2024": [dirent("trip", true), dirent("a.jpg", false)],
      "/media/fam/2024/trip": [dirent("trip-photo.jpg", false), dirent("notes.txt", false)],
    };
    return {
      readdir: async (p: string) => tree[p] ?? [],
      stat: async () => ({ size: 1, mtimeMs: 1 }),
      findIndexedPhotos: async (_catalogId, rels) =>
        rels.includes("2024/trip/trip-photo.jpg")
          ? [{ id: "p1", path: "2024/trip/trip-photo.jpg" }]
          : [],
    };
  }

  it("finds matches nested in subfolders and links indexed photos", async () => {
    const res = await searchCatalogTree(catalog, "", "trip", treeDeps());
    expect(res.dirs.map((d) => d.rel)).toEqual(["2024/trip"]);
    expect(res.files.map((f) => f.rel)).toEqual(["2024/trip/trip-photo.jpg"]);
    expect(res.files[0]).toMatchObject({ photoId: "p1", isImage: true });
    expect(res.dirs[0]).toMatchObject({ folderCount: 0, fileCount: 2 });
  });

  it("returns nothing for a blank query", async () => {
    expect(await searchCatalogTree(catalog, "", "  ", treeDeps())).toEqual({
      dirs: [],
      files: [],
      truncated: false,
    });
  });

  it("blocks path traversal outside the catalog", async () => {
    await expect(searchCatalogTree(catalog, "../x", "trip", treeDeps())).rejects.toThrow();
  });
});

describe("listSubfolders", () => {
  function dirent(name: string, isDir: boolean) {
    return { name, isDirectory: () => isDir };
  }
  const catalog = { id: "cat1", path: "/media/fam" };
  it("returns sorted immediate subdirectories with rel paths", async () => {
    const deps: SubfolderDeps = {
      readdir: async () => [dirent("b", true), dirent("a", true), dirent("x.jpg", false)],
    };
    expect(await listSubfolders(catalog, "2024", deps)).toEqual([
      { name: "a", rel: "2024/a" },
      { name: "b", rel: "2024/b" },
    ]);
  });
  it("blocks path traversal", async () => {
    const deps: SubfolderDeps = { readdir: async () => [] };
    await expect(listSubfolders(catalog, "../x", deps)).rejects.toThrow();
  });
});

