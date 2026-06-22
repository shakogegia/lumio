import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { listTrash, restorePhotos, trashPhotos } from "./trash-service.js";

const CAT = "cat-1";

async function dirs() {
  const photosDir = await mkdtemp(path.join(tmpdir(), "lumio-photos-"));
  const cacheDir = await mkdtemp(path.join(tmpdir(), "lumio-cache-"));
  // Per-catalog trash dir (caller is responsible for the per-catalog sub-path)
  const trashDir = await mkdtemp(path.join(tmpdir(), "lumio-trash-"));
  await mkdir(path.join(cacheDir, "thumbnails"), { recursive: true });
  await mkdir(path.join(cacheDir, "displays"), { recursive: true });
  return { photosDir, cacheDir, trashDir };
}

function trashRow(id: string) {
  return {
    id,
    catalogId: CAT,
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
  it("snapshots (incl. catalogId + colorLabel + albums), moves files into trash, deletes the photo row", async () => {
    const { photosDir, cacheDir, trashDir } = await dirs();
    await writeFile(path.join(photosDir, "a.jpg"), "orig");
    await writeFile(path.join(cacheDir, "thumbnails", "a.webp"), "thumb");
    await writeFile(path.join(cacheDir, "displays", "a.webp"), "display");

    const created: unknown[] = [];
    const db = {
      photo: {
        findFirst: async () => ({
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

    const result = await trashPhotos(["a"], { db: db as never, catalogId: CAT, photosDir, cacheDir, trashDir });

    expect(result).toEqual({ trashed: 1 });
    // Scoping assertion: trash snapshot includes catalogId
    expect(created).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          id: "a",
          catalogId: CAT,
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
    expect(db.photo.deleteMany).toHaveBeenCalledWith({ where: { id: "a", catalogId: CAT } });
  });

  it("skips ids that no longer exist", async () => {
    const { photosDir, cacheDir, trashDir } = await dirs();
    const db = {
      photo: { findFirst: async () => null, deleteMany: vi.fn() },
      trashedPhoto: { create: vi.fn() },
    };
    const result = await trashPhotos(["gone"], { db: db as never, catalogId: CAT, photosDir, cacheDir, trashDir });
    expect(result).toEqual({ trashed: 0 });
    expect(db.trashedPhoto.create).not.toHaveBeenCalled();
  });
});

describe("listTrash", () => {
  it("returns a page with items + total scoped to the catalog, newest-first order", async () => {
    const rows = [trashRow("a"), trashRow("b")];
    const receivedWhere: unknown[] = [];
    const db = {
      trashedPhoto: {
        findMany: async (args: { where?: unknown; skip?: number; take: number; orderBy?: unknown }) => {
          receivedWhere.push(args.where);
          expect(args.orderBy).toEqual([{ deletedAt: "desc" }, { id: "desc" }]);
          const skip = args.skip ?? 0;
          return rows.slice(skip, skip + args.take);
        },
        count: async (args: { where?: unknown }) => {
          receivedWhere.push(args.where);
          return rows.length;
        },
      },
    };
    const page = await listTrash(CAT, { limit: 2, offset: 0 }, db as never);
    expect(page.items.map((p) => p.id)).toEqual(["a", "b"]);
    expect(page.total).toBe(2);
    // Scoping assertion: both findMany and count carry catalogId
    expect(receivedWhere).toEqual([{ catalogId: CAT }, { catalogId: CAT }]);
  });

  it("returns total = 1 when only one item exists in the catalog", async () => {
    const db = {
      trashedPhoto: {
        findMany: async () => [trashRow("a")],
        count: async () => 1,
      },
    };
    const page = await listTrash(CAT, { limit: 2, offset: 0 }, db as never);
    expect(page.total).toBe(1);
  });
});

describe("restorePhotos", () => {
  it("recreates the photo (same id + catalogId + colorLabel + surviving albums) and moves files back", async () => {
    const { photosDir, cacheDir, trashDir } = await dirs();
    await mkdir(path.join(trashDir, "originals"), { recursive: true });
    await mkdir(path.join(trashDir, "thumbnails"), { recursive: true });
    await mkdir(path.join(trashDir, "displays"), { recursive: true });
    await writeFile(path.join(trashDir, "originals", "a.jpg"), "orig");
    await writeFile(path.join(trashDir, "thumbnails", "a.webp"), "thumb");
    await writeFile(path.join(trashDir, "displays", "a.webp"), "display");

    let createArgs: { data: { id: string; catalogId: string; path: string; colorLabel: unknown; fileSize: number; fileModifiedAt: Date; fileCreatedAt: Date; albums: { create: { albumId: string }[] } } } | null = null;
    const db = {
      trashedPhoto: {
        findFirst: async () => ({ ...trashRow("a"), colorLabel: "blue", albumIds: ["keep", "gone"] }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      album: { findMany: async () => [{ id: "keep" }] },
      photo: {
        create: async (args: never) => {
          createArgs = args;
          return {};
        },
      },
    };

    const result = await restorePhotos(["a"], { db: db as never, catalogId: CAT, photosDir, cacheDir, trashDir });

    expect(result).toEqual({ restored: 1 });
    expect(createArgs!.data.id).toBe("a");
    // Scoping assertion: restored photo carries catalogId
    expect(createArgs!.data.catalogId).toBe(CAT);
    expect(createArgs!.data.path).toBe("a.jpg");
    expect(createArgs!.data.colorLabel).toBe("blue");
    expect(createArgs!.data.albums.create).toEqual([{ albumId: "keep" }]);
    expect(createArgs!.data.fileSize).toBe(4); // "orig" is 4 bytes
    expect(createArgs!.data.fileModifiedAt).toBeInstanceOf(Date);
    expect(createArgs!.data.fileCreatedAt).toBeInstanceOf(Date);
    expect(existsSync(path.join(photosDir, "a.jpg"))).toBe(true);
    expect(existsSync(path.join(cacheDir, "thumbnails", "a.webp"))).toBe(true);
    expect(db.trashedPhoto.deleteMany).toHaveBeenCalledWith({ where: { id: "a", catalogId: CAT } });
  });

  it("restores to a suffixed path when the original path is occupied", async () => {
    const { photosDir, cacheDir, trashDir } = await dirs();
    await writeFile(path.join(photosDir, "a.jpg"), "a different file");
    await mkdir(path.join(trashDir, "originals"), { recursive: true });
    await writeFile(path.join(trashDir, "originals", "a.jpg"), "orig");

    let restoredPath = "";
    const db = {
      trashedPhoto: { findFirst: async () => trashRow("a"), deleteMany: async () => ({ count: 1 }) },
      album: { findMany: async () => [] },
      photo: {
        create: async (args: { data: { path: string } }) => {
          restoredPath = args.data.path;
          return {};
        },
      },
    };

    await restorePhotos(["a"], { db: db as never, catalogId: CAT, photosDir, cacheDir, trashDir });
    expect(restoredPath).toBe("a (restored).jpg");
    expect(existsSync(path.join(photosDir, "a (restored).jpg"))).toBe(true);
  });
});
