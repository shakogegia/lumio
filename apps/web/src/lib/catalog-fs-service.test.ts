import { describe, expect, it } from "vitest";
import { listSubfolders, type SubfolderDeps } from "./catalog-fs-service.js";

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
