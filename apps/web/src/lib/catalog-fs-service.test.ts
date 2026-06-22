import { describe, expect, it } from "vitest";
import { readCatalogDir, type CatalogDirDeps } from "./catalog-fs-service.js";

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
