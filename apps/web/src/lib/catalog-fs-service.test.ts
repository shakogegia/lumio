import { describe, expect, it } from "vitest";
import { readCatalogDir, type CatalogDirDeps } from "./catalog-fs-service.js";

function dirent(name: string, isDir: boolean) {
  return { name, isDirectory: () => isDir };
}

const catalog = { id: "cat1", path: "/media/fam" };

function deps(): CatalogDirDeps {
  return {
    readdir: async () => [dirent("2024", true), dirent("a.jpg", false), dirent("note.txt", false)],
    stat: async (p: string) => ({ size: p.endsWith("a.jpg") ? 100 : 5 }),
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
    expect(listing.dirs).toEqual([{ name: "2024", rel: "2024" }]);
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
