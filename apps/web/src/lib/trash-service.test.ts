import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { listTrash, purgeTrash, restorePhotos, trashPhotos } from "./trash-service.js";

async function dirs() {
  const photosDir = await mkdtemp(path.join(tmpdir(), "lumio-photos-"));
  const cacheDir = await mkdtemp(path.join(tmpdir(), "lumio-cache-"));
  const trashDir = await mkdtemp(path.join(tmpdir(), "lumio-trash-"));
  await mkdir(path.join(cacheDir, "thumbnails"), { recursive: true });
  await mkdir(path.join(cacheDir, "displays"), { recursive: true });
  return { photosDir, cacheDir, trashDir };
}

function trashRow(id: string) {
  return {
    id,
    originalPath: `${id}.jpg`,
    source: "filesystem" as const,
    takenAt: null,
    sortDate: new Date("2024-01-01T00:00:00.000Z"),
    width: 10,
    height: 10,
    hash: null,
    exif: {},
    colorLabel: null,
    albumIds: [],
    deletedAt: new Date("2026-06-19T00:00:00.000Z"),
  };
}

describe("trashPhotos", () => {
  it("snapshots (incl. colorLabel + albums), moves files into trash, deletes the photo row", async () => {
    const { photosDir, cacheDir, trashDir } = await dirs();
    await writeFile(path.join(photosDir, "a.jpg"), "orig");
    await writeFile(path.join(cacheDir, "thumbnails", "a.webp"), "thumb");
    await writeFile(path.join(cacheDir, "displays", "a.webp"), "display");

    const created: unknown[] = [];
    const db = {
      photo: {
        findUnique: async () => ({
          id: "a",
          path: "a.jpg",
          source: "filesystem",
          takenAt: null,
          sortDate: new Date("2024-01-01T00:00:00.000Z"),
          width: 10,
          height: 10,
          hash: null,
          exif: {},
          colorLabel: "green",
          albums: [{ albumId: "alb1" }],
        }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      trashedPhoto: {
        create: async (args: unknown) => {
          created.push(args);
          return {};
        },
      },
    };

    const result = await trashPhotos(["a"], { db: db as never, photosDir, cacheDir, trashDir });

    expect(result).toEqual({ trashed: 1 });
    expect(created).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          id: "a",
          originalPath: "a.jpg",
          colorLabel: "green",
          albumIds: ["alb1"],
        }),
      }),
    ]);
    expect(existsSync(path.join(photosDir, "a.jpg"))).toBe(false);
    expect(existsSync(path.join(trashDir, "originals", "a.jpg"))).toBe(true);
    expect(existsSync(path.join(trashDir, "thumbnails", "a.webp"))).toBe(true);
    expect(existsSync(path.join(trashDir, "displays", "a.webp"))).toBe(true);
    expect(db.photo.deleteMany).toHaveBeenCalledWith({ where: { id: "a" } });
  });

  it("skips ids that no longer exist", async () => {
    const { photosDir, cacheDir, trashDir } = await dirs();
    const db = {
      photo: { findUnique: async () => null, deleteMany: vi.fn() },
      trashedPhoto: { create: vi.fn() },
    };
    const result = await trashPhotos(["gone"], { db: db as never, photosDir, cacheDir, trashDir });
    expect(result).toEqual({ trashed: 0 });
    expect(db.trashedPhoto.create).not.toHaveBeenCalled();
  });
});

describe("listTrash", () => {
  it("returns a page with nextCursor = last id when full, newest-first order", async () => {
    const rows = [trashRow("a"), trashRow("b")];
    const db = {
      trashedPhoto: {
        findMany: async (args: { take: number; orderBy?: unknown }) => {
          expect(args.orderBy).toEqual([{ deletedAt: "desc" }, { id: "desc" }]);
          return rows.slice(0, args.take);
        },
      },
    };
    const page = await listTrash({ limit: 2 }, db as never);
    expect(page.items.map((p) => p.id)).toEqual(["a", "b"]);
    expect(page.nextCursor).toBe("b");
  });

  it("returns nextCursor = null when fewer than limit", async () => {
    const db = { trashedPhoto: { findMany: async () => [trashRow("a")] } };
    const page = await listTrash({ limit: 2 }, db as never);
    expect(page.nextCursor).toBeNull();
  });
});

describe("restorePhotos", () => {
  it("recreates the photo (same id + colorLabel + surviving albums) and moves files back", async () => {
    const { photosDir, cacheDir, trashDir } = await dirs();
    await mkdir(path.join(trashDir, "originals"), { recursive: true });
    await mkdir(path.join(trashDir, "thumbnails"), { recursive: true });
    await mkdir(path.join(trashDir, "displays"), { recursive: true });
    await writeFile(path.join(trashDir, "originals", "a.jpg"), "orig");
    await writeFile(path.join(trashDir, "thumbnails", "a.webp"), "thumb");
    await writeFile(path.join(trashDir, "displays", "a.webp"), "display");

    let createArgs: { data: { id: string; path: string; colorLabel: unknown; albums: { create: { albumId: string }[] } } } | null = null;
    const db = {
      trashedPhoto: {
        findUnique: async () => ({ ...trashRow("a"), colorLabel: "blue", albumIds: ["keep", "gone"] }),
        delete: vi.fn().mockResolvedValue({}),
      },
      album: { findMany: async () => [{ id: "keep" }] },
      photo: {
        create: async (args: never) => {
          createArgs = args;
          return {};
        },
      },
    };

    const result = await restorePhotos(["a"], { db: db as never, photosDir, cacheDir, trashDir });

    expect(result).toEqual({ restored: 1 });
    expect(createArgs!.data.id).toBe("a");
    expect(createArgs!.data.path).toBe("a.jpg");
    expect(createArgs!.data.colorLabel).toBe("blue");
    expect(createArgs!.data.albums.create).toEqual([{ albumId: "keep" }]);
    expect(existsSync(path.join(photosDir, "a.jpg"))).toBe(true);
    expect(existsSync(path.join(cacheDir, "thumbnails", "a.webp"))).toBe(true);
    expect(db.trashedPhoto.delete).toHaveBeenCalledWith({ where: { id: "a" } });
  });

  it("restores to a suffixed path when the original path is occupied", async () => {
    const { photosDir, cacheDir, trashDir } = await dirs();
    await writeFile(path.join(photosDir, "a.jpg"), "a different file");
    await mkdir(path.join(trashDir, "originals"), { recursive: true });
    await writeFile(path.join(trashDir, "originals", "a.jpg"), "orig");

    let restoredPath = "";
    const db = {
      trashedPhoto: { findUnique: async () => trashRow("a"), delete: async () => ({}) },
      album: { findMany: async () => [] },
      photo: {
        create: async (args: { data: { path: string } }) => {
          restoredPath = args.data.path;
          return {};
        },
      },
    };

    await restorePhotos(["a"], { db: db as never, photosDir, cacheDir, trashDir });
    expect(restoredPath).toBe("a (restored).jpg");
    expect(existsSync(path.join(photosDir, "a (restored).jpg"))).toBe(true);
  });
});

describe("purgeTrash", () => {
  it("removes trash files and rows for the given ids", async () => {
    const { photosDir, cacheDir, trashDir } = await dirs();
    await mkdir(path.join(trashDir, "originals"), { recursive: true });
    await mkdir(path.join(trashDir, "thumbnails"), { recursive: true });
    await writeFile(path.join(trashDir, "originals", "a.jpg"), "orig");
    await writeFile(path.join(trashDir, "thumbnails", "a.webp"), "thumb");

    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = {
      trashedPhoto: {
        findMany: async () => [{ id: "a", originalPath: "a.jpg" }],
        deleteMany,
      },
    };

    const result = await purgeTrash(["a"], { db: db as never, photosDir, cacheDir, trashDir });

    expect(result).toEqual({ deleted: 1 });
    expect(existsSync(path.join(trashDir, "originals", "a.jpg"))).toBe(false);
    expect(existsSync(path.join(trashDir, "thumbnails", "a.webp"))).toBe(false);
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["a"] } } });
  });

  it("empties everything when ids is undefined", async () => {
    const { photosDir, cacheDir, trashDir } = await dirs();
    const deleteMany = vi.fn().mockResolvedValue({ count: 3 });
    const db = { trashedPhoto: { findMany: async () => [], deleteMany } };
    const result = await purgeTrash(undefined, { db: db as never, photosDir, cacheDir, trashDir });
    expect(result).toEqual({ deleted: 3 });
    expect(deleteMany).toHaveBeenCalledWith({ where: {} });
  });
});
