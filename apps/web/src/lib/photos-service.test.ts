import { describe, expect, it, vi } from "vitest";
import {
  getNeighborsForWhere,
  getPhotoNeighbors,
  listPhotos,
  setPhotoColorLabel,
  setPhotoFavorite,
} from "./photos-service.js";

function row(id: string) {
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
    const page = await listPhotos({ limit: 2, offset: 0 }, db as never);
    expect(page.items.map((p) => p.id)).toEqual(["a", "b"]);
    expect(page.total).toBe(3);
    expect(db.calls[0]).toMatchObject({ skip: 0, take: 2 });
    expect(db.calls[0]?.orderBy).toEqual([{ sortDate: "desc" }, { id: "desc" }]);
  });

  it("applies offset for a later page", async () => {
    const db = fakeDb([row("a"), row("b"), row("c")]);
    const page = await listPhotos({ limit: 2, offset: 2 }, db as never);
    expect(page.items.map((p) => p.id)).toEqual(["c"]);
    expect(page.total).toBe(3);
    expect(db.calls[0]).toMatchObject({ skip: 2, take: 2 });
  });

  it("orders by createdAt desc when sort is imported-desc", async () => {
    const db = fakeDb([row("a")]);
    await listPhotos({ limit: 2, offset: 0, sort: "imported-desc" }, db as never);
    expect(db.calls[0]?.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
  });

  it("filters by a UTC sortDate range when month is set", async () => {
    const db = fakeDb([row("a")]);
    await listPhotos({ limit: 50, offset: 0, month: "2026-06" }, db as never);
    expect(db.calls[0]?.where).toEqual({
      sortDate: {
        gte: new Date("2026-06-01T00:00:00.000Z"),
        lt: new Date("2026-07-01T00:00:00.000Z"),
      },
    });
  });

  it("uses an empty where when no month is set", async () => {
    const db = fakeDb([row("a")]);
    await listPhotos({ limit: 50, offset: 0 }, db as never);
    expect(db.calls[0]?.where).toEqual({});
  });

  it("filters by isFavorite when favorite is true", async () => {
    const db = fakeDb([row("a")]);
    await listPhotos({ limit: 50, offset: 0, favorite: true }, db as never);
    expect(db.calls[0]?.where).toEqual({ isFavorite: true });
  });

  it("uses an empty where when favorite is false", async () => {
    const db = fakeDb([row("a")]);
    await listPhotos({ limit: 50, offset: 0, favorite: false }, db as never);
    expect(db.calls[0]?.where).toEqual({});
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

// Wraps keysetDb so the same ordered set also answers album.findUnique with a
// regular (non-smart) album — exercises the albumId != null / albumPhotoWhere path.
function albumKeysetDb(albumId: string, ordered: Array<{ id: string; path: string }>) {
  return {
    ...keysetDb(ordered),
    album: {
      findUnique: async () => ({
        id: albumId,
        name: "Scoped",
        isSmart: false,
        rules: null,
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
    const n = await getPhotoNeighbors({ id: "p2", path: "p2.jpg" }, null, "taken-desc", 10, db as never);
    expect(n.prevId).toBe("p1");
    expect(n.nextId).toBe("p3");
    expect(n.strip.map((s) => s.id)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
  });

  it("nulls prevId at the start and nextId at the end", async () => {
    const ordered = strip(3);
    const db = keysetDb(ordered);
    const first = await getPhotoNeighbors({ id: "p0", path: "p0.jpg" }, null, "taken-desc", 10, db as never);
    expect(first.prevId).toBeNull();
    expect(first.nextId).toBe("p1");
    const last = await getPhotoNeighbors({ id: "p2", path: "p2.jpg" }, null, "taken-desc", 10, db as never);
    expect(last.prevId).toBe("p1");
    expect(last.nextId).toBeNull();
  });

  it("clamps the window near an edge", async () => {
    const ordered = strip(10);
    const db = keysetDb(ordered);
    const n = await getPhotoNeighbors({ id: "p1", path: "p1.jpg" }, null, "taken-desc", 2, db as never);
    // window=2: before is clamped to [p0], after is [p2, p3]
    expect(n.strip.map((s) => s.id)).toEqual(["p0", "p1", "p2", "p3"]);
    expect(n.prevId).toBe("p0");
    expect(n.nextId).toBe("p2");
  });

  it("returns a single-item strip with no neighbors when the photo is alone", async () => {
    const db = keysetDb(strip(1));
    const n = await getPhotoNeighbors({ id: "p0", path: "p0.jpg" }, null, "taken-desc", 10, db as never);
    expect(n.prevId).toBeNull();
    expect(n.nextId).toBeNull();
    expect(n.strip.map((s) => s.id)).toEqual(["p0"]);
  });

  it("degrades to a single-item strip when the album is missing", async () => {
    const db = {
      album: { findUnique: async () => null },
      photo: {
        findMany: async () => {
          throw new Error("should not query photos");
        },
      },
    };
    const n = await getPhotoNeighbors({ id: "p2", path: "p2.jpg" }, "ghost", "taken-desc", 10, db as never);
    expect(n).toEqual({ prevId: null, nextId: null, strip: [{ id: "p2", path: "p2.jpg" }] });
  });

  it("scopes neighbors to an album (regular album)", async () => {
    const ordered = strip(5); // the album's photos, already in PHOTO_ORDER
    const db = albumKeysetDb("alb1", ordered);
    const n = await getPhotoNeighbors({ id: "p2", path: "p2.jpg" }, "alb1", "taken-desc", 10, db as never);
    expect(n.prevId).toBe("p1");
    expect(n.nextId).toBe("p3");
    expect(n.strip.map((s) => s.id)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
  });

  it("scopes neighbors to a smart album (rule-based where, no throw)", async () => {
    const ordered = strip(5); // the photos the smart rule matches, in PHOTO_ORDER
    const db = {
      ...keysetDb(ordered),
      album: {
        findUnique: async () => ({
          id: "smart1",
          name: "Smart",
          isSmart: true,
          rules: {
            match: "all",
            rules: [{ field: "exif.cameraModel", op: "eq", value: "TestCam" }],
          },
          createdAt: new Date("2024-01-01T00:00:00.000Z"),
          updatedAt: new Date("2024-01-01T00:00:00.000Z"),
        }),
      },
    };
    const n = await getPhotoNeighbors({ id: "p2", path: "p2.jpg" }, "smart1", "taken-desc", 10, db as never);
    expect(n.prevId).toBe("p1");
    expect(n.nextId).toBe("p3");
    expect(n.strip.map((s) => s.id)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
  });
});

describe("setPhotoColorLabel", () => {
  it("sets a label on the given photos and returns the count", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 3 });
    const db = { photo: { updateMany } };
    const count = await setPhotoColorLabel(["p1", "p2", "p3"], "green", db as never);
    expect(count).toBe(3);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["p1", "p2", "p3"] } },
      data: { colorLabel: "green" },
    });
  });

  it("clears the label when given null", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = { photo: { updateMany } };
    const count = await setPhotoColorLabel(["p1"], null, db as never);
    expect(count).toBe(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["p1"] } },
      data: { colorLabel: null },
    });
  });
});

describe("setPhotoFavorite", () => {
  it("sets isFavorite on the given photos and returns the count", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const db = { photo: { updateMany } };
    const count = await setPhotoFavorite(["p1", "p2"], true, db as never);
    expect(count).toBe(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["p1", "p2"] } },
      data: { isFavorite: true },
    });
  });

  it("clears isFavorite when given false", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = { photo: { updateMany } };
    await setPhotoFavorite(["p1"], false, db as never);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["p1"] } },
      data: { isFavorite: false },
    });
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
      {},
      "imported-asc",
      5,
      db as never,
    );
    expect(orderBys).toEqual([
      [{ createdAt: "asc" }, { id: "asc" }],
      [{ createdAt: "asc" }, { id: "asc" }],
    ]);
  });
});
