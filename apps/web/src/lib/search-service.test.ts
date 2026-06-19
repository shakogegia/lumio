import { describe, expect, it } from "vitest";
import { searchPhotos } from "./search-service.js";

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
  const calls: Array<{ take: number; where?: unknown; orderBy?: unknown }> = [];
  return {
    calls,
    photo: {
      findMany: async (args: { take: number; where?: unknown; orderBy?: unknown }) => {
        calls.push(args);
        return rows.slice(0, args.take);
      },
    },
  };
}

describe("searchPhotos", () => {
  it("builds the where from album + q and paginates over PHOTO_ORDER", async () => {
    const db = fakeDb([row("a"), row("b")]);
    const page = await searchPhotos({ limit: 2, album: ["alb1"], q: "beach" }, db as never);
    expect(page.items.map((p) => p.id)).toEqual(["a", "b"]);
    expect(page.nextCursor).toBe("b");
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
    const page = await searchPhotos({ limit: 2, album: [] }, db as never);
    expect(db.calls[0]?.where).toEqual({});
    expect(page.nextCursor).toBeNull();
  });

  it("orders by createdAt asc when sort is imported-asc", async () => {
    const db = fakeDb([row("a")]);
    await searchPhotos({ limit: 2, album: [], sort: "imported-asc" }, db as never);
    expect(db.calls[0]?.orderBy).toEqual([{ createdAt: "asc" }, { id: "asc" }]);
  });
});
