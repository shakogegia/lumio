import { describe, expect, it, vi } from "vitest";
import {
  createFolder,
  deleteFolder,
  FolderCycleError,
  FolderNotFoundError,
  getFolder,
  listFolderContents,
  moveItems,
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

describe("deleteFolder reparent", () => {
  it("reparents direct children to the deleted folder's parent, then deletes it", async () => {
    const folderUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const albumUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const folderDelete = vi.fn().mockResolvedValue({});
    const db = {
      folder: {
        findUnique: async () => ({ parentId: "grandparent" }),
        updateMany: folderUpdateMany,
        delete: folderDelete,
      },
      album: { updateMany: albumUpdateMany },
      albumPhoto: {},
      photo: {},
      $transaction: async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]),
    };
    await deleteFolder("italy", "reparent", db as never);
    expect(folderUpdateMany).toHaveBeenCalledWith({
      where: { parentId: "italy" }, data: { parentId: "grandparent" },
    });
    expect(albumUpdateMany).toHaveBeenCalledWith({
      where: { folderId: "italy" }, data: { folderId: "grandparent" },
    });
    expect(folderDelete).toHaveBeenCalledWith({ where: { id: "italy" } });
  });

  it("throws when the folder is missing", async () => {
    const db = {
      folder: { findUnique: async () => null }, album: {}, albumPhoto: {}, photo: {},
      $transaction: async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]),
    };
    await expect(deleteFolder("x", "reparent", db as never)).rejects.toBeInstanceOf(
      FolderNotFoundError,
    );
  });
});

describe("deleteFolder cascade", () => {
  it("deletes all descendant albums then all descendant folders, leaving photos", async () => {
    const allFolders = [
      { id: "europe", parentId: null },
      { id: "italy", parentId: "europe" },
    ];
    const albumDeleteMany = vi.fn().mockResolvedValue({ count: 3 });
    const folderDeleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const db = {
      folder: { findMany: async () => allFolders, deleteMany: folderDeleteMany },
      album: { deleteMany: albumDeleteMany },
      albumPhoto: {},
      photo: {},
      $transaction: async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]),
    };
    await deleteFolder("europe", "cascade", db as never);
    const albumArg = albumDeleteMany.mock.calls[0][0].where.folderId.in.sort();
    const folderArg = folderDeleteMany.mock.calls[0][0].where.id.in.sort();
    expect(albumArg).toEqual(["europe", "italy"]);
    expect(folderArg).toEqual(["europe", "italy"]);
  });

  it("throws when the folder is missing", async () => {
    const db = {
      folder: { findMany: async () => [{ id: "other", parentId: null }] },
      album: {}, albumPhoto: {}, photo: {},
      $transaction: async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]),
    };
    await expect(deleteFolder("ghost", "cascade", db as never)).rejects.toBeInstanceOf(
      FolderNotFoundError,
    );
  });
});

describe("moveItems", () => {
  const allFolders = [
    { id: "europe", parentId: null },
    { id: "italy", parentId: "europe" },
    { id: "asia", parentId: null },
  ];

  function db(folderUpdate = vi.fn().mockResolvedValue({ count: 1 }), albumUpdate = vi.fn().mockResolvedValue({ count: 1 })) {
    return {
      folder: { findMany: async () => allFolders, updateMany: folderUpdate },
      album: { updateMany: albumUpdate },
      albumPhoto: {},
      photo: {},
      $transaction: async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]),
    };
  }

  it("moves an album into a folder", async () => {
    const albumUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const count = await moveItems({ albumIds: ["a1"], targetFolderId: "italy" }, db(undefined, albumUpdate) as never);
    expect(albumUpdate).toHaveBeenCalledWith({ where: { id: { in: ["a1"] } }, data: { folderId: "italy" } });
    expect(count).toBe(1);
  });

  it("moves a folder to top level (null target)", async () => {
    const folderUpdate = vi.fn().mockResolvedValue({ count: 1 });
    await moveItems({ folderIds: ["italy"], targetFolderId: null }, db(folderUpdate) as never);
    expect(folderUpdate).toHaveBeenCalledWith({ where: { id: { in: ["italy"] } }, data: { parentId: null } });
  });

  it("rejects moving a folder into its own descendant", async () => {
    await expect(
      moveItems({ folderIds: ["europe"], targetFolderId: "italy" }, db() as never),
    ).rejects.toBeInstanceOf(FolderCycleError);
  });

  it("rejects moving a folder into itself", async () => {
    await expect(
      moveItems({ folderIds: ["europe"], targetFolderId: "europe" }, db() as never),
    ).rejects.toBeInstanceOf(FolderCycleError);
  });

  it("throws when the target folder does not exist", async () => {
    await expect(
      moveItems({ albumIds: ["a1"], targetFolderId: "ghost" }, db() as never),
    ).rejects.toBeInstanceOf(FolderNotFoundError);
  });
});
