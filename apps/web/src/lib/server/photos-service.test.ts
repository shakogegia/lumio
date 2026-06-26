import { describe, expect, it, vi } from "vitest";
import {
  getNeighborsForWhere,
  getPhoto,
  getPhotoFile,
  getPhotoNeighbors,
  listPhotos,
  listPhotosForDownload,
  listPhotosForWhere,
  photoExistsInCatalog,
  photoOrTrashedExistsInCatalog,
  setPhotoColorLabel,
  setPhotoFavorite,
} from "./photos-service.js";

const CAT = "cat1";

function row(id: string) {
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

function fakeDb(rows: ReturnType<typeof row>[]) {
  const calls: Array<{ skip?: number; take: number; where?: unknown; orderBy?: unknown }> = [];
  return {
    calls,
    photo: {
      findMany: async (args: { skip?: number; take: number; where?: unknown; orderBy?: unknown }) => {
        calls.push(args);
        const skip = args.skip ?? 0;
        return rows.slice(skip, skip + args.take);
      },
      count: async () => rows.length,
    },
  };
}

describe("listPhotos", () => {
  it("returns the page slice and the full total", async () => {
    const db = fakeDb([row("a"), row("b"), row("c")]);
    const page = await listPhotos(CAT, { limit: 2, offset: 0 }, db as never);
    expect(page.items.map((p) => p.id)).toEqual(["a", "b"]);
    expect(page.total).toBe(3);
    expect(db.calls[0]).toMatchObject({ skip: 0, take: 2 });
    expect(db.calls[0]?.orderBy).toEqual([{ sortDate: "desc" }, { id: "desc" }]);
  });

  it("applies offset for a later page", async () => {
    const db = fakeDb([row("a"), row("b"), row("c")]);
    const page = await listPhotos(CAT, { limit: 2, offset: 2 }, db as never);
    expect(page.items.map((p) => p.id)).toEqual(["c"]);
    expect(page.total).toBe(3);
    expect(db.calls[0]).toMatchObject({ skip: 2, take: 2 });
  });

  it("orders by createdAt desc when sort is imported-desc", async () => {
    const db = fakeDb([row("a")]);
    await listPhotos(CAT, { limit: 2, offset: 0, sort: "imported-desc" }, db as never);
    expect(db.calls[0]?.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
  });

  it("always includes catalogId in the where clause", async () => {
    const db = fakeDb([row("a")]);
    await listPhotos(CAT, { limit: 50, offset: 0 }, db as never);
    expect(db.calls[0]?.where).toMatchObject({ catalogId: CAT });
  });

  it("filters by a UTC sortDate range AND catalogId when month is set", async () => {
    const db = fakeDb([row("a")]);
    await listPhotos(CAT, { limit: 50, offset: 0, month: "2026-06" }, db as never);
    expect(db.calls[0]?.where).toEqual({
      catalogId: CAT,
      trashedAt: null,
      sortDate: {
        gte: new Date("2026-06-01T00:00:00.000Z"),
        lt: new Date("2026-07-01T00:00:00.000Z"),
      },
    });
  });

  it("uses only catalogId where when no month is set", async () => {
    const db = fakeDb([row("a")]);
    await listPhotos(CAT, { limit: 50, offset: 0 }, db as never);
    expect(db.calls[0]?.where).toEqual({ catalogId: CAT, trashedAt: null });
  });

  it("filters by isFavorite AND catalogId when favorite is true", async () => {
    const db = fakeDb([row("a")]);
    await listPhotos(CAT, { limit: 50, offset: 0, favorite: true }, db as never);
    expect(db.calls[0]?.where).toEqual({ catalogId: CAT, trashedAt: null, isFavorite: true });
  });

  it("uses only catalogId where when favorite is false", async () => {
    const db = fakeDb([row("a")]);
    await listPhotos(CAT, { limit: 50, offset: 0, favorite: false }, db as never);
    expect(db.calls[0]?.where).toEqual({ catalogId: CAT, trashedAt: null });
  });

  it("filters by createdAt range when dateField is 'imported'", async () => {
    const db = fakeDb([row("a")]);
    await listPhotos(CAT, { limit: 50, offset: 0, month: "2024-06", dateField: "imported" }, db as never);
    expect(db.calls[0]?.where).toEqual({
      catalogId: CAT,
      trashedAt: null,
      createdAt: {
        gte: new Date("2024-06-01T00:00:00.000Z"),
        lt: new Date("2024-07-01T00:00:00.000Z"),
      },
    });
  });

  it("filters by metadataValues when dateField is a meta: field", async () => {
    const db = fakeDb([row("a")]);
    await listPhotos(CAT, { limit: 50, offset: 0, month: "2024-06", dateField: "meta:clx1" }, db as never);
    expect(db.calls[0]?.where).toEqual({
      catalogId: CAT,
      trashedAt: null,
      metadataValues: { some: { fieldId: "clx1", value: { gte: "2024-06-01", lt: "2024-07-01" } } },
    });
  });
});

describe("listPhotosForDownload", () => {
  it("scopes the download list by catalogId", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const db = { photo: { findMany } };
    await listPhotosForDownload(CAT, ["p1", "p2"], db as never);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { catalogId: CAT, id: { in: ["p1", "p2"] } } }),
    );
  });
});

describe("getPhoto", () => {
  it("returns null for a photo that exists in a different catalog", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const db = { photo: { findFirst } };
    const result = await getPhoto(CAT, "foreign-id", db as never);
    expect(result).toBeNull();
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "foreign-id", catalogId: CAT, trashedAt: null } }),
    );
  });

  it("returns the photo when it belongs to the given catalog", async () => {
    const photoRow = {
      ...row("p1"),
      catalogId: CAT,
      albums: [],
      colorLabel: null,
      isFavorite: false,
      thumbhash: null,
      edits: null,
    };
    const findFirst = vi.fn().mockResolvedValue(photoRow);
    const db = { photo: { findFirst } };
    const result = await getPhoto(CAT, "p1", db as never);
    expect(result).not.toBeNull();
    expect(result?.id).toBe("p1");
  });
});

// Simulates Prisma cursor pagination over an array that is already in PHOTO_ORDER.
// Positive take = rows after the cursor; negative take = rows before it (returned
// in array order, matching Prisma's "paginate backwards").
function keysetDb(ordered: Array<{ id: string; path: string }>) {
  return {
    photo: {
      findMany: async (args: { cursor: { id: string }; skip: number; take: number }) => {
        const idx = ordered.findIndex((r) => r.id === args.cursor.id);
        if (idx === -1) return [];
        if (args.take >= 0) {
          return ordered.slice(idx + args.skip, idx + args.skip + args.take);
        }
        // skip:1 excludes the cursor itself; guard so the fake can't mask a skip change.
        if (args.skip !== 1) throw new Error(`expected skip:1, got skip:${args.skip}`);
        const end = idx;
        return ordered.slice(Math.max(0, end + args.take), end);
      },
    },
  };
}

// Wraps keysetDb so the same ordered set also answers album.findFirst with a
// regular (non-smart) album for the catalog-scoped lookup
// (where: { id, catalogId }) — exercises the albumId != null / albumPhotoWhere path.
function albumKeysetDb(albumId: string, ordered: Array<{ id: string; path: string }>) {
  return {
    ...keysetDb(ordered),
    album: {
      findFirst: async () => ({
        id: albumId,
        name: "Scoped",
        isSmart: false,
        rules: null,
        catalogId: CAT,
        folderId: null,
        coverPhotoId: null,
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
        updatedAt: new Date("2024-01-01T00:00:00.000Z"),
      }),
    },
  };
}

const strip = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, path: `p${i}.jpg` }));

describe("getPhotoNeighbors", () => {
  it("returns the immediate prev/next and a centered strip (library scope)", async () => {
    const ordered = strip(5); // p0 (newest) .. p4 (oldest), already in PHOTO_ORDER
    const db = keysetDb(ordered);
    const n = await getPhotoNeighbors(CAT, { id: "p2", path: "p2.jpg" }, null, "taken-desc", 10, db as never);
    expect(n.prevId).toBe("p1");
    expect(n.nextId).toBe("p3");
    expect(n.strip.map((s) => s.id)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
  });

  it("nulls prevId at the start and nextId at the end", async () => {
    const ordered = strip(3);
    const db = keysetDb(ordered);
    const first = await getPhotoNeighbors(CAT, { id: "p0", path: "p0.jpg" }, null, "taken-desc", 10, db as never);
    expect(first.prevId).toBeNull();
    expect(first.nextId).toBe("p1");
    const last = await getPhotoNeighbors(CAT, { id: "p2", path: "p2.jpg" }, null, "taken-desc", 10, db as never);
    expect(last.prevId).toBe("p1");
    expect(last.nextId).toBeNull();
  });

  it("clamps the window near an edge", async () => {
    const ordered = strip(10);
    const db = keysetDb(ordered);
    const n = await getPhotoNeighbors(CAT, { id: "p1", path: "p1.jpg" }, null, "taken-desc", 2, db as never);
    // window=2: before is clamped to [p0], after is [p2, p3]
    expect(n.strip.map((s) => s.id)).toEqual(["p0", "p1", "p2", "p3"]);
    expect(n.prevId).toBe("p0");
    expect(n.nextId).toBe("p2");
  });

  it("returns a single-item strip with no neighbors when the photo is alone", async () => {
    const db = keysetDb(strip(1));
    const n = await getPhotoNeighbors(CAT, { id: "p0", path: "p0.jpg" }, null, "taken-desc", 10, db as never);
    expect(n.prevId).toBeNull();
    expect(n.nextId).toBeNull();
    expect(n.strip.map((s) => s.id)).toEqual(["p0"]);
  });

  it("degrades to a single-item strip when the album is missing", async () => {
    const db = {
      album: { findFirst: async () => null },
      photo: {
        findMany: async () => {
          throw new Error("should not query photos");
        },
      },
    };
    const n = await getPhotoNeighbors(CAT, { id: "p2", path: "p2.jpg" }, "ghost", "taken-desc", 10, db as never);
    expect(n).toEqual({ prevId: null, nextId: null, strip: [{ id: "p2", path: "p2.jpg" }] });
  });

  it("scopes neighbors to an album (regular album)", async () => {
    const ordered = strip(5); // the album's photos, already in PHOTO_ORDER
    const db = albumKeysetDb("alb1", ordered);
    const n = await getPhotoNeighbors(CAT, { id: "p2", path: "p2.jpg" }, "alb1", "taken-desc", 10, db as never);
    expect(n.prevId).toBe("p1");
    expect(n.nextId).toBe("p3");
    expect(n.strip.map((s) => s.id)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
  });

  it("scopes neighbors to a smart album (rule-based where, no throw)", async () => {
    const ordered = strip(5); // the photos the smart rule matches, in PHOTO_ORDER
    const db = {
      ...keysetDb(ordered),
      album: {
        findFirst: async () => ({
          id: "smart1",
          name: "Smart",
          isSmart: true,
          rules: {
            match: "all",
            rules: [{ field: "exif.cameraModel", op: "eq", value: "TestCam" }],
          },
          catalogId: CAT,
          folderId: null,
          coverPhotoId: null,
          createdAt: new Date("2024-01-01T00:00:00.000Z"),
          updatedAt: new Date("2024-01-01T00:00:00.000Z"),
        }),
      },
    };
    const n = await getPhotoNeighbors(CAT, { id: "p2", path: "p2.jpg" }, "smart1", "taken-desc", 10, db as never);
    expect(n.prevId).toBe("p1");
    expect(n.nextId).toBe("p3");
    expect(n.strip.map((s) => s.id)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
  });

  it("includes catalogId in the neighbor where clause (library scope)", async () => {
    const wheres: unknown[] = [];
    const db = {
      photo: {
        findMany: async (args: { where?: unknown; cursor?: unknown; skip?: number; take: number }) => {
          wheres.push(args.where);
          return [];
        },
      },
    };
    await getPhotoNeighbors(CAT, { id: "p0", path: "p0.jpg" }, null, "taken-desc", 5, db as never);
    for (const w of wheres) {
      expect(w).toMatchObject({ catalogId: CAT });
    }
  });
});

describe("setPhotoColorLabel", () => {
  it("sets a label on the given photos scoped to catalogId and returns the count", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 3 });
    const db = { photo: { updateMany } };
    const count = await setPhotoColorLabel(CAT, ["p1", "p2", "p3"], "green", db as never);
    expect(count).toBe(3);
    expect(updateMany).toHaveBeenCalledWith({
      where: { catalogId: CAT, id: { in: ["p1", "p2", "p3"] } },
      data: { colorLabel: "green" },
    });
  });

  it("clears the label when given null", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = { photo: { updateMany } };
    const count = await setPhotoColorLabel(CAT, ["p1"], null, db as never);
    expect(count).toBe(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { catalogId: CAT, id: { in: ["p1"] } },
      data: { colorLabel: null },
    });
  });
});

describe("setPhotoFavorite", () => {
  it("sets isFavorite on the given photos scoped to catalogId and returns the count", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const db = { photo: { updateMany } };
    const count = await setPhotoFavorite(CAT, ["p1", "p2"], true, db as never);
    expect(count).toBe(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: { catalogId: CAT, id: { in: ["p1", "p2"] } },
      data: { isFavorite: true },
    });
  });

  it("clears isFavorite when given false", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = { photo: { updateMany } };
    await setPhotoFavorite(CAT, ["p1"], false, db as never);
    expect(updateMany).toHaveBeenCalledWith({
      where: { catalogId: CAT, id: { in: ["p1"] } },
      data: { isFavorite: false },
    });
  });
});

describe("photoExistsInCatalog", () => {
  it("is true only when the photo is in the catalog", async () => {
    const findFirst = vi.fn().mockResolvedValueOnce({ id: "p1" }).mockResolvedValueOnce(null);
    const db = { photo: { findFirst } } as never;
    expect(await photoExistsInCatalog("c1", "p1", db)).toBe(true);
    expect(await photoExistsInCatalog("c1", "nope", db)).toBe(false);
  });
});

describe("getPhotoFile", () => {
  it("returns {path} when the photo is in the catalog", async () => {
    const findFirst = vi.fn().mockResolvedValue({ path: "foo.jpg" });
    const db = { photo: { findFirst } } as never;
    const result = await getPhotoFile("c1", "p1", db);
    expect(result).toEqual({ path: "foo.jpg" });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "p1", catalogId: "c1" }, select: { path: true } }),
    );
  });

  it("returns null when the photo is not found", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const db = { photo: { findFirst } } as never;
    expect(await getPhotoFile("c1", "missing", db)).toBeNull();
  });
});

describe("photoOrTrashedExistsInCatalog", () => {
  it("is true if either the live or trashed photo matches", async () => {
    const db = { photo: { findFirst: vi.fn().mockResolvedValue(null) },
                 trashedPhoto: { findFirst: vi.fn().mockResolvedValue({ id: "p1" }) } } as never;
    expect(await photoOrTrashedExistsInCatalog("c1", "p1", db)).toBe(true);
  });
});

describe("getNeighborsForWhere ordering", () => {
  it("orders both neighbor pages by the given sort", async () => {
    const orderBys: unknown[] = [];
    const db = {
      photo: {
        findMany: async (args: { orderBy: unknown }) => {
          orderBys.push(args.orderBy);
          return [];
        },
      },
    };
    await getNeighborsForWhere(
      { id: "p0", path: "p0.jpg" },
      { catalogId: CAT },
      "imported-asc",
      5,
      db as never,
    );
    expect(orderBys).toEqual([
      [{ createdAt: "asc" }, { id: "asc" }],
      [{ createdAt: "asc" }, { id: "asc" }],
    ]);
  });

  it("excludes trashed photos from both neighbor pages via trashedAt: null", async () => {
    const wheres: Array<Record<string, unknown>> = [];
    const db = {
      photo: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          wheres.push(args.where);
          return [];
        },
      },
    };
    await getNeighborsForWhere(
      { id: "p0", path: "p0.jpg" },
      { catalogId: CAT },
      "taken-desc",
      5,
      db as never,
    );
    expect(wheres).toHaveLength(2);
    for (const w of wheres) {
      expect(w).toMatchObject({ catalogId: CAT, trashedAt: null });
    }
  });
});

describe("listPhotosForWhere — metadata sort routing", () => {
  it("routes a valid meta sort to the value-side reader", async () => {
    const db = {
      metadataField: { findFirst: async () => ({ id: "d1" }) },
      photo: {
        count: async () => 1,
        findMany: async () => [], // unvalued segment
      },
      photoMetadataValue: {
        count: async () => 1,
        findMany: async () => [{ photo: row("a") }],
      },
    };
    const page = await listPhotosForWhere(CAT, {}, { limit: 50, offset: 0, sort: "meta:d1:asc" }, db as never);
    expect(page.items.map((p) => p.id)).toEqual(["a"]);
  });

  it("falls back to the standard reader when the meta field is invalid", async () => {
    const orderBys: unknown[] = [];
    const db = {
      metadataField: { findFirst: async () => null },
      photo: {
        count: async () => 1,
        findMany: async (args: { orderBy: unknown }) => {
          orderBys.push(args.orderBy);
          return [row("a")];
        },
      },
    };
    const page = await listPhotosForWhere(CAT, {}, { limit: 50, offset: 0, sort: "meta:zzz:asc" }, db as never);
    expect(page.items.map((p) => p.id)).toEqual(["a"]);
    // invalid meta -> default ordering (imported-desc)
    expect(orderBys[0]).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
  });
});

describe("getNeighborsForWhere — metadata sort routing", () => {
  it("takes the metadata window branch for a valid Date field (degrades to [current] when the window is empty)", async () => {
    const db = {
      metadataField: { findFirst: async () => ({ id: "d1" }) },
      photoMetadataValue: {
        findUnique: async () => ({ value: "v" }), // current is valued
        count: async () => 0, // seg1count and "before" both 0 -> index 0
      },
      photo: { findMany: async () => [] }, // no unvalued rows in the window
    };
    const n = await getNeighborsForWhere({ id: "p0", path: "p0.jpg" }, { catalogId: CAT }, "meta:d1:asc", 5, db as never);
    expect(n.strip.map((s) => s.id)).toEqual(["p0"]);
    expect(n.prevId).toBeNull();
    expect(n.nextId).toBeNull();
  });
});
