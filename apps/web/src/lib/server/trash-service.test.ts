import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { listTrash, restorePhotos } from "./trash-service.js";

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

describe("listTrash", () => {
  it("returns a page with items + total scoped to the catalog, newest-first order", async () => {
    const rows = [trashRow("a"), trashRow("b")];
    const receivedWhere: unknown[] = [];
    const db = {
      photo: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
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
    // Same deletedAt → tiebreaker is descending id ("b" > "a")
    expect(page.items.map((p) => p.id)).toEqual(["b", "a"]);
    expect(page.total).toBe(2);
    // Scoping assertion: trashedPhoto findMany and count carry catalogId
    expect(receivedWhere).toEqual([{ catalogId: CAT }, { catalogId: CAT }]);
  });

  it("returns total = 1 when only one item exists in the catalog", async () => {
    const db = {
      photo: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
      trashedPhoto: {
        findMany: async () => [trashRow("a")],
        count: async () => 1,
      },
    };
    const page = await listTrash(CAT, { limit: 2, offset: 0 }, db as never);
    expect(page.total).toBe(1);
  });
});

describe("listTrash (dual-state)", () => {
  it("merges pending Photos + TrashedPhoto, newest-first, deduped by id", async () => {
    const pending = [
      { id: "p_new", path: "p_new.jpg", source: "filesystem", takenAt: null, sortDate: new Date(0),
        width: 1, height: 1, hash: null, thumbhash: null, exif: {}, colorLabel: null,
        edits: null, asShotTempK: null, asShotTint: null, isFavorite: false,
        fileModifiedAt: new Date(0), fileCreatedAt: new Date(0),
        createdAt: new Date(0), updatedAt: new Date(0), trashedAt: new Date("2026-06-25T12:00:00Z") },
    ];
    const trashed = [
      { id: "t_old", originalPath: "t_old.jpg", source: "filesystem", takenAt: null, sortDate: new Date(0),
        width: 1, height: 1, hash: null, thumbhash: null, exif: {}, colorLabel: null, albumIds: [],
        deletedAt: new Date("2026-06-25T10:00:00Z"), catalogId: "cat1" },
    ];
    const db = {
      photo: { findMany: vi.fn().mockResolvedValue(pending), count: vi.fn().mockResolvedValue(1) },
      trashedPhoto: { findMany: vi.fn().mockResolvedValue(trashed), count: vi.fn().mockResolvedValue(1) },
    } as never;
    const page = await listTrash("cat1", { limit: 50, offset: 0 } as never, db);
    expect(page.total).toBe(2);
    expect(page.items.map((i) => i.id)).toEqual(["p_new", "t_old"]); // newest trash-time first
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

    let upsertArgs: { where: { id: string }; create: { id: string; catalogId: string; path: string; colorLabel: unknown; fileSize: number; fileModifiedAt: Date; fileCreatedAt: Date; albums: { create: { albumId: string }[] } }; update: { trashedAt: null } } | null = null;
    const db = {
      trashedPhoto: {
        findFirst: async () => ({ ...trashRow("a"), colorLabel: "blue", albumIds: ["keep", "gone"] }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      album: { findMany: async () => [{ id: "keep" }] },
      photo: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert: async (args: never) => {
          upsertArgs = args;
          return {};
        },
      },
    };

    const result = await restorePhotos(["a"], { db: db as never, catalogId: CAT, photosDir, cacheDir, trashDir });

    expect(result).toEqual({ restored: 1 });
    expect(upsertArgs!.where).toEqual({ id: "a" });
    expect(upsertArgs!.create.id).toBe("a");
    // Scoping assertion: restored photo carries catalogId
    expect(upsertArgs!.create.catalogId).toBe(CAT);
    expect(upsertArgs!.create.path).toBe("a.jpg");
    expect(upsertArgs!.create.colorLabel).toBe("blue");
    expect(upsertArgs!.create.albums.create).toEqual([{ albumId: "keep" }]);
    expect(upsertArgs!.create.fileSize).toBe(4); // "orig" is 4 bytes
    expect(upsertArgs!.create.fileModifiedAt).toBeInstanceOf(Date);
    expect(upsertArgs!.create.fileCreatedAt).toBeInstanceOf(Date);
    expect(upsertArgs!.update).toEqual({ trashedAt: null });
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
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert: async (args: { create: { path: string } }) => {
          restoredPath = args.create.path;
          return {};
        },
      },
    };

    await restorePhotos(["a"], { db: db as never, catalogId: CAT, photosDir, cacheDir, trashDir });
    expect(restoredPath).toBe("a (restored).jpg");
    expect(existsSync(path.join(photosDir, "a (restored).jpg"))).toBe(true);
  });
});

describe("restorePhotos (dual-state)", () => {
  it("clears trashedAt for pending ids without moving files", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const trashedFindFirst = vi.fn().mockResolvedValue(null); // not finalized
    const db = {
      photo: { updateMany, upsert: vi.fn() },
      trashedPhoto: { findFirst: trashedFindFirst, deleteMany: vi.fn() },
      album: { findMany: vi.fn().mockResolvedValue([]) },
    } as never;
    const result = await restorePhotos(["pend1"], {
      db, catalogId: "cat1", photosDir: "/p", cacheDir: "/c", trashDir: "/t",
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["pend1"] }, catalogId: "cat1", trashedAt: { not: null } },
      data: { trashedAt: null },
    });
    expect(result.restored).toBe(1);
  });
});
