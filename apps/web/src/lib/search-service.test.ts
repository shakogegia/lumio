import { describe, expect, it } from "vitest";
import { countSearchPhotos, searchPhotos } from "./search-service.js";

const CAT = "cat-1";

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

describe("searchPhotos", () => {
  it("builds the where from catalogId + album + q and returns items + total", async () => {
    const db = fakeDb([row("a"), row("b")]);
    const page = await searchPhotos(CAT, { limit: 2, offset: 0, album: ["alb1"], q: "beach" }, db as never);
    expect(page.items.map((p) => p.id)).toEqual(["a", "b"]);
    expect(page.total).toBe(2);
    expect(db.calls[0]?.where).toEqual({
      catalogId: CAT,
      AND: [
        { albums: { some: { albumId: { in: ["alb1"] } } } },
        { path: { contains: "beach", mode: "insensitive" } },
      ],
    });
    expect(db.calls[0]?.orderBy).toEqual([{ sortDate: "desc" }, { id: "desc" }]);
  });

  it("scopes to catalogId even when there are no other filters", async () => {
    const db = fakeDb([row("a")]);
    const page = await searchPhotos(CAT, { limit: 2, offset: 0, album: [] }, db as never);
    expect(db.calls[0]?.where).toEqual({ catalogId: CAT });
    expect(page.total).toBe(1);
  });

  it("orders by createdAt asc when sort is imported-asc", async () => {
    const db = fakeDb([row("a")]);
    await searchPhotos(CAT, { limit: 2, offset: 0, album: [], sort: "imported-asc" }, db as never);
    expect(db.calls[0]?.orderBy).toEqual([{ createdAt: "asc" }, { id: "asc" }]);
  });

  it("ANDs a UTC sortDate range into the search where when month is set", async () => {
    const db = fakeDb([row("a")]);
    await searchPhotos(CAT, { limit: 50, offset: 0, album: [], month: "2026-06" }, db as never);
    expect(db.calls[0]?.where).toEqual({
      AND: [
        { catalogId: CAT },
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

function fakeCountDb(total: number) {
  const calls: Array<{ where?: unknown }> = [];
  return {
    calls,
    photo: {
      count: async (args: { where?: unknown }) => {
        calls.push(args);
        return total;
      },
    },
  };
}

describe("countSearchPhotos", () => {
  it("counts with the same where as searchPhotos (catalogId + album + q)", async () => {
    const db = fakeCountDb(42);
    const total = await countSearchPhotos(CAT, { limit: 50, offset: 0, album: ["alb1"], q: "beach" }, db as never);
    expect(total).toBe(42);
    expect(db.calls[0]?.where).toEqual({
      catalogId: CAT,
      AND: [
        { albums: { some: { albumId: { in: ["alb1"] } } } },
        { path: { contains: "beach", mode: "insensitive" } },
      ],
    });
  });

  it("scopes to catalogId even when there are no other filters", async () => {
    const db = fakeCountDb(0);
    const total = await countSearchPhotos(CAT, { limit: 50, offset: 0, album: [] }, db as never);
    expect(total).toBe(0);
    expect(db.calls[0]?.where).toEqual({ catalogId: CAT });
  });

  it("counts with the plain catalogId where when no month is set", async () => {
    const counts: Array<{ where?: unknown }> = [];
    const db = {
      photo: {
        count: async (args: { where?: unknown }) => {
          counts.push(args);
          return 7;
        },
      },
    };
    const total = await countSearchPhotos(CAT, { limit: 50, offset: 0, album: [] }, db as never);
    expect(total).toBe(7);
    expect(counts[0]?.where).toEqual({ catalogId: CAT });
  });

  it("ANDs a sortDate range into the count where when month is set", async () => {
    const counts: Array<{ where?: unknown }> = [];
    const db = {
      photo: {
        count: async (args: { where?: unknown }) => {
          counts.push(args);
          return 2;
        },
      },
    };
    await countSearchPhotos(CAT, { limit: 50, offset: 0, album: [], month: "2026-06" }, db as never);
    expect(counts[0]?.where).toEqual({
      AND: [
        { catalogId: CAT },
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
