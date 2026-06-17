import { describe, expect, it } from "vitest";
import { listPhotos } from "./photos-service.js";

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
  const calls: Array<{ take: number; orderBy?: unknown }> = [];
  return {
    calls,
    photo: {
      findMany: async (args: { take: number; orderBy?: unknown }) => {
        calls.push(args);
        return rows.slice(0, args.take);
      },
    },
  };
}

describe("listPhotos", () => {
  it("returns nextCursor = last id when a full page is returned", async () => {
    const db = fakeDb([row("a"), row("b")]);
    const page = await listPhotos({ limit: 2 }, db as never);
    expect(page.items.map((p) => p.id)).toEqual(["a", "b"]);
    expect(page.nextCursor).toBe("b");
    expect(db.calls[0]?.orderBy).toEqual([{ sortDate: "desc" }, { id: "desc" }]);
  });

  it("returns nextCursor = null when fewer than limit are returned", async () => {
    const db = fakeDb([row("a")]);
    const page = await listPhotos({ limit: 2 }, db as never);
    expect(page.nextCursor).toBeNull();
  });
});
