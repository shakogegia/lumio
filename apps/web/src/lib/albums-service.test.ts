import { describe, expect, it, vi } from "vitest";
import {
  addPhotosToAlbum,
  listAlbumPhotos,
  listAlbumSummaries,
  removePhotosFromAlbum,
  SmartAlbumMutationError,
} from "./albums-service.js";

// Minimal Album row shape for tests
function albumRow(overrides: Partial<{
  id: string;
  name: string;
  isSmart: boolean;
  rules: object | null;
  createdAt: Date;
  updatedAt: Date;
}> = {}) {
  return {
    id: "alb1",
    name: "Test Album",
    isSmart: false,
    rules: null,
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

    const summaries = await listAlbumSummaries(fakeDb as never);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.photoCount).toBe(3);
    expect(summaries[0]?.coverPhotoId).toBe("p9");
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

    const summaries = await listAlbumSummaries(fakeDb as never);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.isSmart).toBe(true);
    expect(summaries[0]?.photoCount).toBe(2);
    expect(summaries[0]?.coverPhotoId).toBe("pX");
  });
});

describe("listAlbumPhotos", () => {
  it("returns page with nextCursor when full page returned", async () => {
    const rows = [photoRow("p1"), photoRow("p2")];
    const fakeDb = {
      album: {
        findUnique: async () => albumRow(),
      },
      albumPhoto: {},
      photo: {
        findMany: async () => rows,
        count: async () => 0,
        findFirst: async () => null,
      },
    };

    const page = await listAlbumPhotos("alb1", { limit: 2 }, fakeDb as never);
    expect(page).not.toBeNull();
    expect(page!.items.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(page!.nextCursor).toBe("p2");
  });

  it("returns null when album not found", async () => {
    const fakeDb = {
      album: {
        findUnique: async () => null,
      },
      albumPhoto: {},
      photo: {},
    };

    const page = await listAlbumPhotos("missing", { limit: 10 }, fakeDb as never);
    expect(page).toBeNull();
  });
});

describe("addPhotosToAlbum", () => {
  it("throws SmartAlbumMutationError for smart albums", async () => {
    const fakeDb = {
      album: { findUnique: async () => ({ isSmart: true }) },
      albumPhoto: {},
      photo: {},
    };
    await expect(
      addPhotosToAlbum("alb1", ["p1"], fakeDb as never),
    ).rejects.toBeInstanceOf(SmartAlbumMutationError);
  });

  it("createMany with skipDuplicates and returns the inserted count", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const fakeDb = {
      album: { findUnique: async () => ({ isSmart: false }) },
      albumPhoto: { createMany },
      photo: {},
    };
    const count = await addPhotosToAlbum("alb1", ["p1", "p2"], fakeDb as never);
    expect(count).toBe(2);
    expect(createMany).toHaveBeenCalledWith({
      data: [
        { albumId: "alb1", photoId: "p1" },
        { albumId: "alb1", photoId: "p2" },
      ],
      skipDuplicates: true,
    });
  });
});

describe("removePhotosFromAlbum", () => {
  it("throws SmartAlbumMutationError for smart albums", async () => {
    const fakeDb = {
      album: { findUnique: async () => ({ isSmart: true }) },
      albumPhoto: {},
      photo: {},
    };
    await expect(
      removePhotosFromAlbum("alb1", ["p1"], fakeDb as never),
    ).rejects.toBeInstanceOf(SmartAlbumMutationError);
  });

  it("deleteMany on the given ids and returns the removed count", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const fakeDb = {
      album: { findUnique: async () => ({ isSmart: false }) },
      albumPhoto: { deleteMany },
      photo: {},
    };
    const count = await removePhotosFromAlbum("alb1", ["p1", "p2"], fakeDb as never);
    expect(count).toBe(2);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { albumId: "alb1", photoId: { in: ["p1", "p2"] } },
    });
  });
});
