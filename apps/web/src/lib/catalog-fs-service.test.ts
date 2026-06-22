import { describe, expect, it } from "vitest";
import { listSubfolderSummaries, subtreeWhere, type FolderSummaryDeps } from "./catalog-fs-service.js";

describe("subtreeWhere", () => {
  it("matches the dir itself and any descendant", () => {
    expect(subtreeWhere("cat1", "2024/trip")).toEqual({
      catalogId: "cat1",
      OR: [{ dirPath: "2024/trip" }, { dirPath: { startsWith: "2024/trip/" } }],
    });
  });
});

describe("listSubfolderSummaries", () => {
  function dirent(name: string, isDir: boolean) {
    return { name, isDirectory: () => isDir };
  }
  const catalog = { id: "cat1", path: "/media/fam" };

  it("summarizes each immediate subfolder (sorted) with recursive count/previews + immediate subfolder count", async () => {
    const tree: Record<string, { name: string; isDirectory: () => boolean }[]> = {
      "/media/fam/2024": [dirent("b", true), dirent("a", true), dirent("x.jpg", false)],
      "/media/fam/2024/a": [dirent("sub1", true), dirent("sub2", true), dirent("p.jpg", false)],
      "/media/fam/2024/b": [dirent("y.jpg", false)],
    };
    const deps: FolderSummaryDeps = {
      readdir: async (abs) => tree[abs] ?? [],
      countPhotos: async (_c, rel) => (rel === "2024/a" ? 5 : 2),
      previewPhotoIds: async (_c, rel) => (rel === "2024/a" ? ["p1", "p2"] : ["p3"]),
    };
    expect(await listSubfolderSummaries(catalog, "2024", deps)).toEqual([
      { name: "a", rel: "2024/a", subfolderCount: 2, photoCount: 5, previewPhotoIds: ["p1", "p2"] },
      { name: "b", rel: "2024/b", subfolderCount: 0, photoCount: 2, previewPhotoIds: ["p3"] },
    ]);
  });

  it("reports a subfolder with subfolders but no photos as empty (count 0, no previews)", async () => {
    const tree: Record<string, { name: string; isDirectory: () => boolean }[]> = {
      "/media/fam/2024": [dirent("empty", true)],
      "/media/fam/2024/empty": [dirent("child", true)],
    };
    const deps: FolderSummaryDeps = {
      readdir: async (abs) => tree[abs] ?? [],
      countPhotos: async () => 0,
      previewPhotoIds: async () => [],
    };
    expect(await listSubfolderSummaries(catalog, "2024", deps)).toEqual([
      { name: "empty", rel: "2024/empty", subfolderCount: 1, photoCount: 0, previewPhotoIds: [] },
    ]);
  });

  it("blocks path traversal", async () => {
    const deps: FolderSummaryDeps = {
      readdir: async () => [],
      countPhotos: async () => 0,
      previewPhotoIds: async () => [],
    };
    await expect(listSubfolderSummaries(catalog, "../x", deps)).rejects.toThrow();
  });
});
