import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PHOTO_SORT } from "@lumio/shared";
import { listPhotosByMetadata, metadataNeighbors, metadataSortIndexOf, metadataPageSlice, resolveSort } from "./metadata-sort.js";

describe("metadataPageSlice", () => {
  it("reads entirely within segment 1", () => {
    expect(metadataPageSlice(0, 2, 5)).toEqual({ seg1: { skip: 0, take: 2 }, seg2: null });
  });
  it("straddles the boundary", () => {
    expect(metadataPageSlice(4, 3, 5)).toEqual({ seg1: { skip: 4, take: 1 }, seg2: { skip: 0, take: 2 } });
  });
  it("reads entirely within segment 2", () => {
    expect(metadataPageSlice(7, 3, 5)).toEqual({ seg1: null, seg2: { skip: 2, take: 3 } });
  });
  it("starts exactly at the boundary", () => {
    expect(metadataPageSlice(5, 3, 5)).toEqual({ seg1: null, seg2: { skip: 0, take: 3 } });
  });
  it("handles an empty segment 1", () => {
    expect(metadataPageSlice(0, 2, 0)).toEqual({ seg1: null, seg2: { skip: 0, take: 2 } });
  });
  it("handles a window that exhausts segment 1 with no segment 2 rows requested elsewhere", () => {
    expect(metadataPageSlice(0, 10, 3)).toEqual({ seg1: { skip: 0, take: 3 }, seg2: { skip: 0, take: 7 } });
  });
  it("fits the window exactly in segment 1 (seg2 null)", () => {
    expect(metadataPageSlice(0, 5, 5)).toEqual({ seg1: { skip: 0, take: 5 }, seg2: null });
  });
});

describe("resolveSort", () => {
  const fieldDb = (found: boolean) => ({
    metadataField: { findFirst: vi.fn(async () => (found ? { id: "d1" } : null)) },
  });

  it("returns standard for a fixed sort without querying fields", async () => {
    const db = fieldDb(true);
    const r = await resolveSort("cat1", "taken-asc", db as never);
    expect(r).toEqual({ kind: "standard", sort: "taken-asc" });
    expect(db.metadataField.findFirst).not.toHaveBeenCalled();
  });

  it("returns metadata when the Date field exists and is enabled", async () => {
    const db = fieldDb(true);
    const r = await resolveSort("cat1", "meta:d1:desc", db as never);
    expect(r).toEqual({ kind: "metadata", fieldId: "d1", dir: "desc" });
    expect(db.metadataField.findFirst).toHaveBeenCalledWith({
      where: { id: "d1", catalogId: "cat1", enabled: true, type: "date" },
      select: { id: true },
    });
  });

  it("falls back to the standard default ordering when the field is missing/disabled/wrong-type", async () => {
    const db = fieldDb(false);
    const r = await resolveSort("cat1", "meta:d1:desc", db as never);
    expect(r).toEqual({ kind: "standard", sort: DEFAULT_PHOTO_SORT });
  });

  it("returns standard with no sort when sort is undefined (no field query)", async () => {
    const db = fieldDb(true);
    const r = await resolveSort("cat1", undefined, db as never);
    expect(r).toEqual({ kind: "standard", sort: undefined });
    expect(db.metadataField.findFirst).not.toHaveBeenCalled();
  });
});

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

describe("listPhotosByMetadata", () => {
  it("concatenates valued (ordered by value) then unvalued (ordered by id), total = full count", async () => {
    const valuedOrderBy: unknown[] = [];
    const unvaluedWhere: unknown[] = [];
    const db = {
      photo: {
        count: async () => 4,
        findMany: async (args: { where: unknown; orderBy: unknown }) => {
          unvaluedWhere.push(args.where);
          // unvalued segment, ordered by id asc
          return [photoRow("c"), photoRow("d")];
        },
      },
      photoMetadataValue: {
        count: async () => 2, // seg1count
        findMany: async (args: { orderBy: unknown }) => {
          valuedOrderBy.push(args.orderBy);
          return [{ photo: photoRow("a") }, { photo: photoRow("b") }];
        },
      },
    };
    const page = await listPhotosByMetadata(
      { catalogId: "cat1" },
      { fieldId: "d1", dir: "asc" },
      { limit: 50, offset: 0 },
      db as never,
    );
    expect(page.items.map((p) => p.id)).toEqual(["a", "b", "c", "d"]);
    expect(page.total).toBe(4);
    expect(valuedOrderBy[0]).toEqual([{ value: "asc" }, { photoId: "asc" }]);
    expect(unvaluedWhere[0]).toMatchObject({ catalogId: "cat1", metadataValues: { none: { fieldId: "d1" } } });
  });

  it("reads only segment 2 when the offset is past all valued photos", async () => {
    const db = {
      photo: {
        count: async () => 5,
        findMany: async () => [photoRow("e")],
      },
      photoMetadataValue: {
        count: async () => 2,
        findMany: vi.fn(async () => []),
      },
    };
    const page = await listPhotosByMetadata(
      { catalogId: "cat1" },
      { fieldId: "d1", dir: "desc" },
      { limit: 2, offset: 4 },
      db as never,
    );
    expect(page.items.map((p) => p.id)).toEqual(["e"]);
    expect(db.photoMetadataValue.findMany).not.toHaveBeenCalled();
  });
});

describe("metadataSortIndexOf", () => {
  it("ranks a valued photo by counting valued rows before it (asc)", async () => {
    const db = {
      photoMetadataValue: {
        findUnique: async () => ({ value: "2024-05-01" }),
        count: async (args: { where: { OR?: unknown } }) => {
          expect(args.where.OR).toEqual([
            { value: { lt: "2024-05-01" } },
            { value: "2024-05-01", photoId: { lt: "p5" } },
          ]);
          return 3;
        },
      },
    };
    const i = await metadataSortIndexOf({ id: "p5", path: "p5.jpg" }, { catalogId: "c" }, { fieldId: "d1", dir: "asc" }, db as never);
    expect(i).toBe(3);
  });

  it("ranks an unvalued photo after all valued ones (seg1count + id rank)", async () => {
    const db = {
      photoMetadataValue: {
        findUnique: async () => null,
        count: async () => 6, // seg1count
      },
      photo: {
        count: async (args: { where: { id?: unknown } }) => {
          expect(args.where.id).toEqual({ lt: "p9" });
          return 2;
        },
      },
    };
    const i = await metadataSortIndexOf({ id: "p9", path: "p9.jpg" }, { catalogId: "c" }, { fieldId: "d1", dir: "asc" }, db as never);
    expect(i).toBe(8);
  });
});

describe("metadataNeighbors", () => {
  it("derives prev/next/strip from the window around the current index", async () => {
    // current "b" sits at global index 4 in a fully-valued run of >=6 photos.
    // window 1 -> from = 3, limit = (4 + 1) - 3 + 1 = 3, so the block is the 3
    // valued rows at skip 3 (seg1 only, since seg1count 6 > from+limit).
    const window = [
      { id: "a", path: "a.jpg" },
      { id: "b", path: "b.jpg" }, // current, pos = index(4) - from(3) = 1
      { id: "c", path: "c.jpg" },
    ];
    const db = {
      photoMetadataValue: {
        findUnique: async () => ({ value: "v" }), // current is valued
        // OR present -> "rows before current" = index 4; no OR -> seg1count = 6
        count: async (args: { where: { OR?: unknown } }) => (args.where.OR ? 4 : 6),
        findMany: async () => window.map((p) => ({ photo: p })),
      },
      photo: { findMany: async () => [] }, // seg2 not reached (window is all valued)
    };
    const n = await metadataNeighbors(
      { catalogId: "c" },
      { fieldId: "d1", dir: "asc" },
      { id: "b", path: "b.jpg" },
      1,
      db as never,
    );
    expect(n.strip.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(n.prevId).toBe("a");
    expect(n.nextId).toBe("c");
  });
});
