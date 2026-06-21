import { describe, expect, it, vi } from "vitest";
import {
  createFolder,
  FolderNotFoundError,
  getFolder,
  listFolderContents,
  renameFolder,
} from "./folders-service.js";

function folderRow(o: Partial<{ id: string; name: string; parentId: string | null }> = {}) {
  return {
    id: "f1",
    name: "Folder",
    parentId: null,
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    ...o,
  };
}

describe("createFolder", () => {
  it("creates a top-level folder", async () => {
    const create = vi.fn().mockResolvedValue(folderRow({ id: "f9", name: "Europe" }));
    const db = { folder: { create }, album: {}, albumPhoto: {}, photo: {} };
    const dto = await createFolder({ name: "Europe" }, db as never);
    expect(dto.name).toBe("Europe");
    expect(create).toHaveBeenCalledWith({ data: { name: "Europe", parentId: null } });
  });

  it("throws when the parent does not exist", async () => {
    const db = {
      folder: { findUnique: async () => null, create: vi.fn() },
      album: {}, albumPhoto: {}, photo: {},
    };
    await expect(createFolder({ name: "x", parentId: "ghost" }, db as never)).rejects.toBeInstanceOf(
      FolderNotFoundError,
    );
  });
});

describe("getFolder", () => {
  it("returns the DTO when found", async () => {
    const db = { folder: { findUnique: async () => folderRow() }, album: {}, albumPhoto: {}, photo: {} };
    expect((await getFolder("f1", db as never))?.id).toBe("f1");
  });
  it("returns null when missing", async () => {
    const db = { folder: { findUnique: async () => null }, album: {}, albumPhoto: {}, photo: {} };
    expect(await getFolder("nope", db as never)).toBeNull();
  });
});

describe("renameFolder", () => {
  it("updates and returns the DTO", async () => {
    const update = vi.fn().mockResolvedValue(folderRow({ name: "New" }));
    const db = {
      folder: { findUnique: async () => ({ id: "f1" }), update },
      album: {}, albumPhoto: {}, photo: {},
    };
    expect((await renameFolder("f1", "New", db as never)).name).toBe("New");
    expect(update).toHaveBeenCalledWith({ where: { id: "f1" }, data: { name: "New" } });
  });
  it("throws when missing", async () => {
    const db = { folder: { findUnique: async () => null }, album: {}, albumPhoto: {}, photo: {} };
    await expect(renameFolder("x", "y", db as never)).rejects.toBeInstanceOf(FolderNotFoundError);
  });
});

describe("listFolderContents", () => {
  const folders = [
    folderRow({ id: "europe", name: "Europe", parentId: null }),
    folderRow({ id: "italy", name: "Italy", parentId: "europe" }),
  ];
  const albums = [
    { id: "rome", name: "Rome", isSmart: false, rules: null, folderId: "europe",
      createdAt: new Date("2024-01-01T00:00:00.000Z"), updatedAt: new Date("2024-01-01T00:00:00.000Z") },
  ];

  function db() {
    return {
      folder: { findMany: async () => folders },
      album: { findMany: async () => albums },
      albumPhoto: {
        count: async () => 2,
        findFirst: async () => ({ photoId: "p1" }),
      },
      photo: {
        count: async () => 2,
        findMany: async () => [{ id: "p1" }, { id: "p2" }],
        findFirst: async () => null,
      },
    };
  }

  it("returns null for a missing folder id", async () => {
    expect(await listFolderContents("ghost", db() as never)).toBeNull();
  });

  it("at top level: lists top-level folders and top-level albums", async () => {
    const contents = await listFolderContents(null, db() as never);
    expect(contents).not.toBeNull();
    expect(contents!.folder).toBeNull();
    expect(contents!.subfolders.map((f) => f.id)).toEqual(["europe"]);
    expect(contents!.albums).toHaveLength(0);
    expect(contents!.subfolders[0]?.albumCount).toBe(1);
    expect(contents!.subfolders[0]?.totalPhotoCount).toBe(2);
    expect(contents!.subfolders[0]?.previewPhotoIds).toEqual(["p1", "p2"]);
    expect(contents!.subfolders[0]?.childFolderCount).toBe(1);
  });

  it("inside europe: breadcrumbs + direct child folder italy + direct album rome", async () => {
    const contents = await listFolderContents("europe", db() as never);
    expect(contents!.folder?.id).toBe("europe");
    expect(contents!.breadcrumbs.map((b) => b.id)).toEqual(["europe"]);
    expect(contents!.subfolders.map((f) => f.id)).toEqual(["italy"]);
    expect(contents!.albums.map((a) => a.id)).toEqual(["rome"]);
  });
});
