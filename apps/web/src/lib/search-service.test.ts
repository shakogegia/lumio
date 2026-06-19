import { describe, expect, it } from "vitest";
import { countSearchPhotos, searchPhotos } from "./search-service.js";

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

describe("searchPhotos", () => {
  it("builds the where from album + q and returns items + total", async () => {
    const db = fakeDb([row("a"), row("b")]);
    const page = await searchPhotos({ limit: 2, offset: 0, album: ["alb1"], q: "beach" }, db as never);
    expect(page.items.map((p) => p.id)).toEqual(["a", "b"]);
    expect(page.total).toBe(2);
    expect(db.calls[0]?.where).toEqual({
      AND: [
        { albums: { some: { albumId: { in: ["alb1"] } } } },
        { path: { contains: "beach", mode: "insensitive" } },
      ],
    });
    expect(db.calls[0]?.orderBy).toEqual([{ sortDate: "desc" }, { id: "desc" }]);
  });

  it("uses an empty where when there are no filters", async () => {
    const db = fakeDb([row("a")]);
    const page = await searchPhotos({ limit: 2, offset: 0, album: [] }, db as never);
    expect(db.calls[0]?.where).toEqual({});
    expect(page.total).toBe(1);
  });

  it("orders by createdAt asc when sort is imported-asc", async () => {
    const db = fakeDb([row("a")]);
    await searchPhotos({ limit: 2, offset: 0, album: [], sort: "imported-asc" }, db as never);
    expect(db.calls[0]?.orderBy).toEqual([{ createdAt: "asc" }, { id: "asc" }]);
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
  it("counts with the same where as searchPhotos (album + q)", async () => {
    const db = fakeCountDb(42);
    const total = await countSearchPhotos({ limit: 50, offset: 0, album: ["alb1"], q: "beach" }, db as never);
    expect(total).toBe(42);
    expect(db.calls[0]?.where).toEqual({
      AND: [
        { albums: { some: { albumId: { in: ["alb1"] } } } },
        { path: { contains: "beach", mode: "insensitive" } },
      ],
    });
  });

  it("uses an empty where when there are no filters", async () => {
    const db = fakeCountDb(0);
    const total = await countSearchPhotos({ limit: 50, offset: 0, album: [] }, db as never);
    expect(total).toBe(0);
    expect(db.calls[0]?.where).toEqual({});
  });
});
