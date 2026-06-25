import { describe, expect, it, vi } from "vitest";
import {
  createFolder,
  deleteFolder,
  FolderCycleError,
  FolderNotFoundError,
  getFolder,
  listFolderContents,
  listFolderPhotos,
  moveItems,
  renameFolder,
} from "./folders-service.js";

const CAT = "cat1";

function folderRow(o: Partial<{ id: string; name: string; parentId: string | null; catalogId: string }> = {}) {
  return {
    id: "f1",
    name: "Folder",
    parentId: null,
    catalogId: CAT,
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    ...o,
  };
}

describe("createFolder", () => {
  it("creates a top-level folder with catalogId", async () => {
    const create = vi.fn().mockResolvedValue(folderRow({ id: "f9", name: "Europe" }));
    const db = { folder: { create }, album: {}, albumPhoto: {}, photo: {} };
    const dto = await createFolder(CAT, { name: "Europe" }, db as never);
    expect(dto.name).toBe("Europe");
    expect(create).toHaveBeenCalledWith({ data: { name: "Europe", parentId: null, catalogId: CAT } });
  });

  it("throws when the parent does not exist", async () => {
    const db = {
      folder: { findFirst: async () => null, create: vi.fn() },
      album: {}, albumPhoto: {}, photo: {},
    };
    await expect(createFolder(CAT, { name: "x", parentId: "ghost" }, db as never)).rejects.toBeInstanceOf(
      FolderNotFoundError,
    );
  });
});

describe("getFolder", () => {
  it("returns the DTO when found", async () => {
    const db = { folder: { findFirst: async () => folderRow() }, album: {}, albumPhoto: {}, photo: {} };
    expect((await getFolder(CAT, "f1", db as never))?.id).toBe("f1");
  });
  it("returns null when missing", async () => {
    const db = { folder: { findFirst: async () => null }, album: {}, albumPhoto: {}, photo: {} };
    expect(await getFolder(CAT, "nope", db as never)).toBeNull();
  });
  it("scopes the lookup by catalogId", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const db = { folder: { findFirst }, album: {}, albumPhoto: {}, photo: {} };
    await getFolder(CAT, "f1", db as never);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ catalogId: CAT, id: "f1" }) }),
    );
  });
});

describe("renameFolder", () => {
  it("updates and returns the DTO", async () => {
    const update = vi.fn().mockResolvedValue(folderRow({ name: "New" }));
    const db = {
      folder: { findFirst: async () => ({ id: "f1" }), update },
      album: {}, albumPhoto: {}, photo: {},
    };
    expect((await renameFolder(CAT, "f1", "New", db as never)).name).toBe("New");
    expect(update).toHaveBeenCalledWith({ where: { id: "f1" }, data: { name: "New" } });
  });
  it("throws when missing", async () => {
    const db = { folder: { findFirst: async () => null }, album: {}, albumPhoto: {}, photo: {} };
    await expect(renameFolder(CAT, "x", "y", db as never)).rejects.toBeInstanceOf(FolderNotFoundError);
  });
});

describe("listFolderContents", () => {
  const folders = [
    folderRow({ id: "europe", name: "Europe", parentId: null }),
    folderRow({ id: "italy", name: "Italy", parentId: "europe" }),
  ];
  const albums = [
    { id: "rome", name: "Rome", isSmart: false, rules: null, folderId: "europe", catalogId: CAT,
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
    expect(await listFolderContents(CAT, "ghost", db() as never)).toBeNull();
  });

  it("at top level: lists top-level folders and top-level albums", async () => {
    const contents = await listFolderContents(CAT, null, db() as never);
    expect(contents).not.toBeNull();
    expect(contents!.folder).toBeNull();
    expect(contents!.subfolders.map((f) => f.id)).toEqual(["europe"]);
    expect(contents!.albums).toHaveLength(0);
    expect(contents!.subfolders[0]?.albumCount).toBe(1);
    expect(contents!.subfolders[0]?.totalPhotoCount).toBe(2);
    expect(contents!.subfolders[0]?.previewPhotoIds).toEqual(["p1", "p2"]);
    expect(contents!.subfolders[0]?.childFolderCount).toBe(1);
    expect(contents!.currentPhotoCount).toBeNull();
  });

  it("inside europe: breadcrumbs + direct child folder italy + direct album rome", async () => {
    const contents = await listFolderContents(CAT, "europe", db() as never);
    expect(contents!.folder?.id).toBe("europe");
    expect(contents!.breadcrumbs.map((b) => b.id)).toEqual(["europe"]);
    expect(contents!.subfolders.map((f) => f.id)).toEqual(["italy"]);
    expect(contents!.albums.map((a) => a.id)).toEqual(["rome"]);
    expect(contents!.currentPhotoCount).toBe(2);
  });

  it("scopes folder and album findMany by catalogId", async () => {
    const folderFindMany = vi.fn().mockResolvedValue([]);
    const albumFindMany = vi.fn().mockResolvedValue([]);
    const fakeDb = {
      folder: { findMany: folderFindMany },
      album: { findMany: albumFindMany },
      albumPhoto: {},
      photo: { count: async () => 0, findMany: async () => [], findFirst: async () => null },
    };
    await listFolderContents(CAT, null, fakeDb as never);
    expect(folderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ catalogId: CAT }) }),
    );
    expect(albumFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ catalogId: CAT }) }),
    );
  });

  it("scopes folder photo count by catalogId", async () => {
    const photoCount = vi.fn().mockResolvedValue(0);
    const photoFindMany = vi.fn().mockResolvedValue([]);
    const fakeDb = {
      folder: { findMany: async () => folders },
      album: { findMany: async () => albums },
      albumPhoto: { count: async () => 0, findFirst: async () => null },
      photo: { count: photoCount, findMany: photoFindMany, findFirst: async () => null },
    };
    await listFolderContents(CAT, "europe", fakeDb as never);
    // photo.count calls should all include catalogId
    for (const call of photoCount.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({ where: expect.objectContaining({ catalogId: CAT }) }));
    }
  });
});

describe("deleteFolder reparent", () => {
  it("reparents direct children to the deleted folder's parent, then deletes it", async () => {
    const folderUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const albumUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const folderDelete = vi.fn().mockResolvedValue({});
    const db = {
      folder: {
        findFirst: async () => ({ parentId: "grandparent" }),
        updateMany: folderUpdateMany,
        delete: folderDelete,
      },
      album: { updateMany: albumUpdateMany },
      albumPhoto: {},
      photo: {},
      $transaction: async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]),
    };
    await deleteFolder(CAT, "italy", "reparent", db as never);
    expect(folderUpdateMany).toHaveBeenCalledWith({
      where: { parentId: "italy" }, data: { parentId: "grandparent" },
    });
    expect(albumUpdateMany).toHaveBeenCalledWith({
      where: { folderId: "italy" }, data: { folderId: "grandparent" },
    });
    expect(folderDelete).toHaveBeenCalledWith({ where: { id: "italy" } });
  });

  it("scopes the reparent findFirst by catalogId", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const db = {
      folder: { findFirst },
      album: {},
      albumPhoto: {},
      photo: {},
      $transaction: async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]),
    };
    await expect(deleteFolder(CAT, "italy", "reparent", db as never)).rejects.toBeInstanceOf(FolderNotFoundError);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "italy", catalogId: CAT }) }),
    );
  });

  it("throws when the folder is missing", async () => {
    const db = {
      folder: { findFirst: async () => null }, album: {}, albumPhoto: {}, photo: {},
      $transaction: async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]),
    };
    await expect(deleteFolder(CAT, "x", "reparent", db as never)).rejects.toBeInstanceOf(
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
    await deleteFolder(CAT, "europe", "cascade", db as never);
    const albumArg = albumDeleteMany.mock.calls[0][0].where.folderId.in.sort();
    const folderArg = folderDeleteMany.mock.calls[0][0].where.id.in.sort();
    expect(albumArg).toEqual(["europe", "italy"]);
    expect(folderArg).toEqual(["europe", "italy"]);
  });

  it("scopes cascade findMany and deleteMany by catalogId", async () => {
    const allFolders = [
      { id: "europe", parentId: null },
      { id: "italy", parentId: "europe" },
    ];
    const folderFindMany = vi.fn().mockResolvedValue(allFolders);
    const albumDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const folderDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const db = {
      folder: { findMany: folderFindMany, deleteMany: folderDeleteMany },
      album: { deleteMany: albumDeleteMany },
      albumPhoto: {},
      photo: {},
      $transaction: async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]),
    };
    await deleteFolder(CAT, "europe", "cascade", db as never);
    expect(folderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ catalogId: CAT }) }),
    );
    expect(albumDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ catalogId: CAT }) }),
    );
    expect(folderDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ catalogId: CAT }) }),
    );
  });

  it("throws when the folder is missing", async () => {
    const db = {
      folder: { findMany: async () => [{ id: "other", parentId: null }] },
      album: {}, albumPhoto: {}, photo: {},
      $transaction: async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]),
    };
    await expect(deleteFolder(CAT, "ghost", "cascade", db as never)).rejects.toBeInstanceOf(
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
    const count = await moveItems(CAT, { albumIds: ["a1"], targetFolderId: "italy" }, db(undefined, albumUpdate) as never);
    expect(albumUpdate).toHaveBeenCalledWith({ where: { catalogId: CAT, id: { in: ["a1"] } }, data: { folderId: "italy" } });
    expect(count).toBe(1);
  });

  it("moves a folder to top level (null target)", async () => {
    const folderUpdate = vi.fn().mockResolvedValue({ count: 1 });
    await moveItems(CAT, { folderIds: ["italy"], targetFolderId: null }, db(folderUpdate) as never);
    expect(folderUpdate).toHaveBeenCalledWith({ where: { catalogId: CAT, id: { in: ["italy"] } }, data: { parentId: null } });
  });

  it("rejects moving a folder into its own descendant", async () => {
    await expect(
      moveItems(CAT, { folderIds: ["europe"], targetFolderId: "italy" }, db() as never),
    ).rejects.toBeInstanceOf(FolderCycleError);
  });

  it("rejects moving a folder into itself", async () => {
    await expect(
      moveItems(CAT, { folderIds: ["europe"], targetFolderId: "europe" }, db() as never),
    ).rejects.toBeInstanceOf(FolderCycleError);
  });

  it("throws when the target folder does not exist", async () => {
    await expect(
      moveItems(CAT, { albumIds: ["a1"], targetFolderId: "ghost" }, db() as never),
    ).rejects.toBeInstanceOf(FolderNotFoundError);
  });

  it("scopes cycle-detection findMany and updateMany by catalogId", async () => {
    const folderFindMany = vi.fn().mockResolvedValue(allFolders);
    const folderUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const albumUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const fakeDb = {
      folder: { findMany: folderFindMany, updateMany: folderUpdateMany },
      album: { updateMany: albumUpdateMany },
      albumPhoto: {},
      photo: {},
      $transaction: async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]),
    };
    await moveItems(CAT, { folderIds: ["italy"], albumIds: ["a1"], targetFolderId: null }, fakeDb as never);
    expect(folderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ catalogId: CAT }) }),
    );
    expect(folderUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ catalogId: CAT }) }),
    );
    expect(albumUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ catalogId: CAT }) }),
    );
  });
});

describe("listFolderPhotos", () => {
  const allFolders = [
    { id: "europe", parentId: null },
    { id: "italy", parentId: "europe" },
  ];
  const allAlbums = [
    { id: "rome", isSmart: false, rules: null, folderId: "italy" },
  ];

  it("returns null when the folder is missing", async () => {
    const db = {
      folder: { findMany: async () => allFolders },
      album: { findMany: async () => allAlbums },
      albumPhoto: {},
      photo: {},
      $transaction: async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]),
    };
    expect(await listFolderPhotos(CAT, "ghost", { limit: 10, offset: 0 }, db as never)).toBeNull();
  });

  it("aggregates descendant albums and returns a page", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: "p1", path: "p1.jpg", source: "filesystem", takenAt: new Date("2024-01-01T00:00:00.000Z"),
        fileModifiedAt: new Date("2024-01-01T00:00:00.000Z"), fileCreatedAt: new Date("2024-01-01T00:00:00.000Z"),
        width: 1, height: 1, hash: null, thumbhash: null, exif: {}, colorLabel: null, edits: null,
        isFavorite: false, createdAt: new Date("2024-01-01T00:00:00.000Z"), updatedAt: new Date("2024-01-01T00:00:00.000Z") },
    ]);
    const db = {
      folder: { findMany: async () => allFolders },
      album: { findMany: async () => allAlbums },
      albumPhoto: {},
      photo: { findMany, count: async () => 1 },
      $transaction: async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]),
    };
    const page = await listFolderPhotos(CAT, "europe", { limit: 10, offset: 0 }, db as never);
    expect(page!.total).toBe(1);
    expect(page!.items.map((p) => p.id)).toEqual(["p1"]);
    // catalogId AND-combined with the folderPhotoWhere result
    expect(findMany.mock.calls[0][0].where).toEqual({
      catalogId: CAT,
      trashedAt: null,
      OR: [{ albums: { some: { albumId: { in: ["rome"] } } } }],
    });
  });

  it("scopes folder and album findMany by catalogId in listFolderPhotos", async () => {
    const folderFindMany = vi.fn().mockResolvedValue(allFolders);
    const albumFindMany = vi.fn().mockResolvedValue(allAlbums);
    const db = {
      folder: { findMany: folderFindMany },
      album: { findMany: albumFindMany },
      albumPhoto: {},
      photo: { findMany: vi.fn().mockResolvedValue([]), count: async () => 0 },
      $transaction: async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]),
    };
    await listFolderPhotos(CAT, "europe", { limit: 10, offset: 0 }, db as never);
    expect(folderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ catalogId: CAT }) }),
    );
    expect(albumFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ catalogId: CAT }) }),
    );
  });
});
