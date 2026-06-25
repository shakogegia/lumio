import { describe, expect, it, vi } from "vitest";
import { MatchType } from "@lumio/shared";
import {
  addPhotosToAlbum,
  albumPhotoWhere,
  AlbumNotFoundError,
  deleteAlbums,
  listAlbumPhotos,
  listAlbumSummaries,
  PhotoNotInAlbumError,
  removePhotoFromAlbum,
  removePhotosFromAlbum,
  renameAlbum,
  setAlbumCover,
  SmartAlbumMutationError,
  createAlbum,
} from "./albums-service.js";

const CAT = "cat1";

// Minimal Album row shape for tests
function albumRow(overrides: Partial<{
  id: string;
  name: string;
  isSmart: boolean;
  rules: object | null;
  coverPhotoId: string | null;
  catalogId: string;
  folderId: string | null;
  createdAt: Date;
  updatedAt: Date;
}> = {}) {
  return {
    id: "alb1",
    name: "Test Album",
    isSmart: false,
    rules: null,
    coverPhotoId: null,
    catalogId: CAT,
    folderId: null,
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function photoRow(id: string) {
  return {
    id,
    path: `${id}.jpg`,
    source: "filesystem" as const,
    takenAt: new Date("2024-01-01T00:00:00.000Z"),
    sortDate: new Date("2024-01-01T00:00:00.000Z"),
    fileModifiedAt: new Date("2024-01-01T00:00:00.000Z"),
    fileCreatedAt: new Date("2024-01-01T00:00:00.000Z"),
    width: 10,
    height: 10,
    hash: null,
    exif: {},
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
  };
}

describe("listAlbumSummaries", () => {
  it("returns photoCount and coverPhotoId for a regular album", async () => {
    const fakeDb = {
      album: {
        findMany: async () => [albumRow()],
      },
      albumPhoto: {
        count: async () => 3,
        findFirst: async () => ({ photoId: "p9" }),
      },
      photo: {
        count: async () => 0,
        findFirst: async () => null,
      },
    };

    const summaries = await listAlbumSummaries(CAT, fakeDb as never);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.photoCount).toBe(3);
    expect(summaries[0]?.coverPhotoId).toBe("p9");
  });

  it("scopes the album findMany by catalogId", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const fakeDb = {
      album: { findMany },
      albumPhoto: {},
      photo: {},
    };
    await listAlbumSummaries(CAT, fakeDb as never);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ catalogId: CAT }) }),
    );
  });

  it("evaluates smart albums via photo.* (not albumPhoto.*)", async () => {
    const fakeDb = {
      album: {
        findMany: async () => [
          albumRow({
            id: "s1",
            name: "Cam",
            isSmart: true,
            rules: {
              match: "all",
              rules: [{ field: "exif.cameraModel", op: "eq", value: "TestCam 1" }],
            },
          }),
        ],
      },
      albumPhoto: {
        // These would yield 99 / "wrong" if (incorrectly) used for a smart album.
        count: async () => 99,
        findFirst: async () => ({ photoId: "wrong" }),
      },
      photo: {
        count: async () => 2,
        findFirst: async () => ({ id: "pX" }),
      },
    };

    const summaries = await listAlbumSummaries(CAT, fakeDb as never);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.isSmart).toBe(true);
    expect(summaries[0]?.photoCount).toBe(2);
    expect(summaries[0]?.coverPhotoId).toBe("pX");
  });

  it("scopes smart-album photo queries by catalogId", async () => {
    const photoCount = vi.fn().mockResolvedValue(2);
    const photoFindFirst = vi.fn().mockResolvedValue({ id: "pX" });
    const fakeDb = {
      album: {
        findMany: async () => [
          albumRow({
            id: "s1",
            isSmart: true,
            rules: {
              match: "all",
              rules: [{ field: "exif.cameraModel", op: "eq", value: "TestCam 1" }],
            },
          }),
        ],
      },
      albumPhoto: {},
      photo: { count: photoCount, findFirst: photoFindFirst },
    };
    await listAlbumSummaries(CAT, fakeDb as never);
    expect(photoCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ catalogId: CAT }) }),
    );
    expect(photoFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ catalogId: CAT }) }),
    );
  });
});

describe("listAlbumSummaries pinned cover", () => {
  it("uses the pinned coverPhotoId when it is still a member", async () => {
    const fakeDb = {
      album: { findMany: async () => [albumRow({ coverPhotoId: "pinned1" })] },
      albumPhoto: {
        count: async () => 5,
        findUnique: async () => ({ photoId: "pinned1" }),
        findFirst: async () => ({ photoId: "p9" }),
      },
      photo: { count: async () => 0, findFirst: async () => null },
    };
    const summaries = await listAlbumSummaries(CAT, fakeDb as never);
    expect(summaries[0]?.coverPhotoId).toBe("pinned1");
  });

  it("falls back to the derived cover when the pinned photo is no longer a member", async () => {
    const fakeDb = {
      album: { findMany: async () => [albumRow({ coverPhotoId: "gone" })] },
      albumPhoto: {
        count: async () => 5,
        findUnique: async () => null,
        findFirst: async () => ({ photoId: "p9" }),
      },
      photo: { count: async () => 0, findFirst: async () => null },
    };
    const summaries = await listAlbumSummaries(CAT, fakeDb as never);
    expect(summaries[0]?.coverPhotoId).toBe("p9");
  });
});

describe("createAlbum", () => {
  it("includes catalogId in the create data", async () => {
    const create = vi.fn().mockResolvedValue(albumRow({ id: "new1", name: "My Album" }));
    const fakeDb = { album: { create }, albumPhoto: {}, photo: {} };
    await createAlbum(CAT, { name: "My Album", isSmart: false }, fakeDb as never);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ catalogId: CAT, name: "My Album", isSmart: false }),
    });
  });

  it("includes smart rules and folderId when provided", async () => {
    const create = vi.fn().mockResolvedValue(albumRow({ id: "s1", isSmart: true }));
    const fakeDb = { album: { create }, albumPhoto: {}, photo: {} };
    const rules = { match: MatchType.all, rules: [] };
    await createAlbum(CAT, { name: "Smart", isSmart: true, rules, folderId: "f1" }, fakeDb as never);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ catalogId: CAT, name: "Smart", isSmart: true, rules, folderId: "f1" }),
    });
  });
});

describe("listAlbumPhotos", () => {
  it("returns page with items and total when photos exist", async () => {
    const rows = [photoRow("p1"), photoRow("p2")];
    const fakeDb = {
      album: {
        findFirst: async () => albumRow(),
      },
      albumPhoto: {},
      photo: {
        findMany: async () => rows,
        count: async () => 2,
        findFirst: async () => null,
      },
    };

    const page = await listAlbumPhotos(CAT, "alb1", { limit: 2, offset: 0 }, fakeDb as never);
    expect(page).not.toBeNull();
    expect(page!.items.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(page!.total).toBe(2);
  });

  it("returns null when album not found", async () => {
    const fakeDb = {
      album: {
        findFirst: async () => null,
      },
      albumPhoto: {},
      photo: {},
    };

    const page = await listAlbumPhotos(CAT, "missing", { limit: 10, offset: 0 }, fakeDb as never);
    expect(page).toBeNull();
  });

  it("orders the album photos by the given sort", async () => {
    const calls: Array<{ orderBy?: unknown }> = [];
    const fakeDb = {
      album: { findFirst: async () => albumRow() },
      albumPhoto: {},
      photo: {
        findMany: async (args: { orderBy?: unknown }) => {
          calls.push(args);
          return [];
        },
        count: async () => 0,
        findFirst: async () => null,
      },
    };
    await listAlbumPhotos(CAT, "alb1", { limit: 2, offset: 0, sort: "imported-asc" }, fakeDb as never);
    expect(calls[0]?.orderBy).toEqual([{ createdAt: "asc" }, { id: "asc" }]);
  });

  it("ANDs a UTC sortDate range into the album where when month is set", async () => {
    const calls: Array<{ where?: unknown }> = [];
    const fakeDb = {
      album: { findFirst: async () => albumRow() },
      albumPhoto: {},
      photo: {
        findMany: async (args: { where?: unknown }) => {
          calls.push(args);
          return [];
        },
        count: async () => 0,
        findFirst: async () => null,
      },
    };
    await listAlbumPhotos(CAT, "alb1", { limit: 2, offset: 0, month: "2026-06" }, fakeDb as never);
    // catalogId is at the top level (added by listPhotosForWhere); the album scope
    // and sortDate range are AND-combined alongside it.
    expect(calls[0]?.where).toEqual({
      catalogId: CAT,
      trashedAt: null,
      AND: [
        { albums: { some: { albumId: "alb1" } } },
        {
          sortDate: {
            gte: new Date("2026-06-01T00:00:00.000Z"),
            lt: new Date("2026-07-01T00:00:00.000Z"),
          },
        },
      ],
    });
  });
});

describe("addPhotosToAlbum", () => {
  it("throws SmartAlbumMutationError for smart albums", async () => {
    const fakeDb = {
      album: { findFirst: async () => ({ isSmart: true }) },
      albumPhoto: {},
      photo: {},
    };
    await expect(
      addPhotosToAlbum(CAT, "alb1", ["p1"], fakeDb as never),
    ).rejects.toBeInstanceOf(SmartAlbumMutationError);
  });

  it("createMany with skipDuplicates and returns the inserted count", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const fakeDb = {
      album: { findFirst: async () => ({ isSmart: false }) },
      albumPhoto: { createMany },
      // Only catalog-owned photos are linked; the service filters ids first.
      photo: { findMany: async () => [{ id: "p1" }, { id: "p2" }] },
    };
    const count = await addPhotosToAlbum(CAT, "alb1", ["p1", "p2"], fakeDb as never);
    expect(count).toBe(2);
    expect(createMany).toHaveBeenCalledWith({
      data: [
        { albumId: "alb1", photoId: "p1" },
        { albumId: "alb1", photoId: "p2" },
      ],
      skipDuplicates: true,
    });
  });

  it("throws AlbumNotFoundError when the album does not exist", async () => {
    const fakeDb = {
      album: { findFirst: async () => null },
      albumPhoto: {},
      photo: {},
    };
    await expect(
      addPhotosToAlbum(CAT, "missing", ["p1"], fakeDb as never),
    ).rejects.toBeInstanceOf(AlbumNotFoundError);
  });
});

describe("setAlbumCover", () => {
  it("updates the album's coverPhotoId when the photo is a member", async () => {
    const update = vi.fn().mockResolvedValue({});
    const fakeDb = {
      album: { findFirst: async () => ({ isSmart: false }), update },
      albumPhoto: { findUnique: async () => ({ photoId: "p1" }) },
      photo: {},
    };
    await setAlbumCover(CAT, "alb1", "p1", fakeDb as never);
    expect(update).toHaveBeenCalledWith({
      where: { id: "alb1" },
      data: { coverPhotoId: "p1" },
    });
  });

  it("throws AlbumNotFoundError when the album does not exist", async () => {
    const fakeDb = {
      album: { findFirst: async () => null, update: vi.fn() },
      albumPhoto: {},
      photo: {},
    };
    await expect(
      setAlbumCover(CAT, "missing", "p1", fakeDb as never),
    ).rejects.toBeInstanceOf(AlbumNotFoundError);
  });

  it("throws SmartAlbumMutationError for smart albums", async () => {
    const fakeDb = {
      album: { findFirst: async () => ({ isSmart: true }), update: vi.fn() },
      albumPhoto: {},
      photo: {},
    };
    await expect(
      setAlbumCover(CAT, "alb1", "p1", fakeDb as never),
    ).rejects.toBeInstanceOf(SmartAlbumMutationError);
  });

  it("throws PhotoNotInAlbumError when the photo is not a member", async () => {
    const fakeDb = {
      album: { findFirst: async () => ({ isSmart: false }), update: vi.fn() },
      albumPhoto: { findUnique: async () => null },
      photo: {},
    };
    await expect(
      setAlbumCover(CAT, "alb1", "p1", fakeDb as never),
    ).rejects.toBeInstanceOf(PhotoNotInAlbumError);
  });
});

describe("removePhotosFromAlbum", () => {
  it("throws SmartAlbumMutationError for smart albums", async () => {
    const fakeDb = {
      album: { findFirst: async () => ({ isSmart: true }) },
      albumPhoto: {},
      photo: {},
    };
    await expect(
      removePhotosFromAlbum(CAT, "alb1", ["p1"], fakeDb as never),
    ).rejects.toBeInstanceOf(SmartAlbumMutationError);
  });

  it("deleteMany on the given ids and returns the removed count", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const fakeDb = {
      album: { findFirst: async () => ({ isSmart: false }), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      albumPhoto: { deleteMany },
      photo: {},
    };
    const count = await removePhotosFromAlbum(CAT, "alb1", ["p1", "p2"], fakeDb as never);
    expect(count).toBe(2);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { albumId: "alb1", photoId: { in: ["p1", "p2"] } },
    });
  });

  it("throws AlbumNotFoundError when the album does not exist", async () => {
    const fakeDb = {
      album: { findFirst: async () => null },
      albumPhoto: {},
      photo: {},
    };
    await expect(
      removePhotosFromAlbum(CAT, "missing", ["p1"], fakeDb as never),
    ).rejects.toBeInstanceOf(AlbumNotFoundError);
  });

  it("clears the album cover pin if a removed photo was the cover", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const fakeDb = {
      album: { findFirst: async () => ({ isSmart: false }), updateMany },
      albumPhoto: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
      photo: {},
    };
    await removePhotosFromAlbum(CAT, "alb1", ["p1", "p2"], fakeDb as never);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "alb1", coverPhotoId: { in: ["p1", "p2"] } },
      data: { coverPhotoId: null },
    });
  });
});

describe("removePhotoFromAlbum", () => {
  it("deletes the membership row and clears a matching cover pin", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const fakeDb = {
      album: { findFirst: async () => ({ id: "alb1" }), updateMany },
      albumPhoto: { deleteMany },
      photo: {},
    };
    await removePhotoFromAlbum(CAT, "alb1", "p1", fakeDb as never);
    expect(deleteMany).toHaveBeenCalledWith({ where: { albumId: "alb1", photoId: "p1" } });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "alb1", coverPhotoId: "p1" },
      data: { coverPhotoId: null },
    });
  });

  it("scopes the album gate by catalogId and no-ops when album not in catalog", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const deleteMany = vi.fn();
    const updateMany = vi.fn();
    const fakeDb = {
      album: { findFirst, updateMany },
      albumPhoto: { deleteMany },
      photo: {},
    };
    await removePhotoFromAlbum(CAT, "alb1", "p1", fakeDb as never);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "alb1", catalogId: CAT }) }),
    );
    expect(deleteMany).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe("deleteAlbums", () => {
  it("deleteMany on the given ids and returns the removed count", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const fakeDb = { album: { deleteMany }, albumPhoto: {}, photo: {} };
    const count = await deleteAlbums(CAT, ["a1", "s1"], fakeDb as never);
    expect(count).toBe(2);
    expect(deleteMany).toHaveBeenCalledWith({ where: { catalogId: CAT, id: { in: ["a1", "s1"] } } });
  });

  it("returns 0 when no ids match", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const fakeDb = { album: { deleteMany }, albumPhoto: {}, photo: {} };
    const count = await deleteAlbums(CAT, ["missing"], fakeDb as never);
    expect(count).toBe(0);
  });
});

describe("albumPhotoWhere", () => {
  it("returns a membership where for a regular album", async () => {
    const db = { album: { findFirst: async () => albumRow({ id: "alb1", isSmart: false }) } };
    const where = await albumPhotoWhere(CAT, "alb1", db as never);
    expect(where).toEqual({ albums: { some: { albumId: "alb1" } } });
  });

  it("returns null for a missing album", async () => {
    const db = { album: { findFirst: async () => null } };
    const where = await albumPhotoWhere(CAT, "nope", db as never);
    expect(where).toBeNull();
  });

  it("returns a smart-album where (not a membership clause)", async () => {
    const rules = { match: "all", rules: [{ field: "exif.cameraModel", op: "eq", value: "X" }] };
    const db = {
      album: { findFirst: async () => albumRow({ id: "s1", isSmart: true, rules }) },
    };
    const where = await albumPhotoWhere(CAT, "s1", db as never);
    // Smart albums filter on photo fields, never on album membership.
    expect(where).not.toBeNull();
    expect((where as Record<string, unknown>).albums).toBeUndefined();
  });

  it("scopes the album lookup by catalogId", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const db = { album: { findFirst } };
    await albumPhotoWhere(CAT, "alb1", db as never);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ catalogId: CAT, id: "alb1" }) }),
    );
  });
});

describe("renameAlbum", () => {
  it("updates the name and returns the DTO", async () => {
    const update = vi.fn().mockResolvedValue(albumRow({ name: "Renamed" }));
    const fakeDb = {
      album: { findFirst: async () => ({ id: "alb1" }), update },
      albumPhoto: {},
      photo: {},
    };
    const dto = await renameAlbum(CAT, "alb1", "Renamed", fakeDb as never);
    expect(dto.name).toBe("Renamed");
    expect(update).toHaveBeenCalledWith({ where: { id: "alb1" }, data: { name: "Renamed" } });
  });

  it("throws AlbumNotFoundError when missing", async () => {
    const fakeDb = { album: { findFirst: async () => null }, albumPhoto: {}, photo: {} };
    await expect(renameAlbum(CAT, "missing", "x", fakeDb as never)).rejects.toBeInstanceOf(
      AlbumNotFoundError,
    );
  });
});
