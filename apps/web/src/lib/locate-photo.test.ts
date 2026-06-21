import { describe, expect, it, vi } from "vitest";
import { beforeCursorWhere, locatePhoto } from "./locate-photo.js";

const cursor = {
  id: "p5",
  sortDate: new Date("2024-03-01T00:00:00.000Z"),
  createdAt: new Date("2024-05-01T00:00:00.000Z"),
  fileCreatedAt: new Date("2024-01-15T00:00:00.000Z"),
};

describe("beforeCursorWhere", () => {
  it("taken-desc: earlier index = greater sortDate, id tiebreak desc", () => {
    expect(beforeCursorWhere("taken-desc", cursor)).toEqual({
      OR: [
        { sortDate: { gt: cursor.sortDate } },
        { AND: [{ sortDate: cursor.sortDate }, { id: { gt: "p5" } }] },
      ],
    });
  });

  it("taken-asc: earlier index = lesser sortDate, id tiebreak asc", () => {
    expect(beforeCursorWhere("taken-asc", cursor)).toEqual({
      OR: [
        { sortDate: { lt: cursor.sortDate } },
        { AND: [{ sortDate: cursor.sortDate }, { id: { lt: "p5" } }] },
      ],
    });
  });

  it("imported-desc: keys on createdAt", () => {
    expect(beforeCursorWhere("imported-desc", cursor)).toEqual({
      OR: [
        { createdAt: { gt: cursor.createdAt } },
        { AND: [{ createdAt: cursor.createdAt }, { id: { gt: "p5" } }] },
      ],
    });
  });

  it("imported-asc: keys on createdAt, directions flipped", () => {
    expect(beforeCursorWhere("imported-asc", cursor)).toEqual({
      OR: [
        { createdAt: { lt: cursor.createdAt } },
        { AND: [{ createdAt: cursor.createdAt }, { id: { lt: "p5" } }] },
      ],
    });
  });

  it("file-created-desc: keys on fileCreatedAt", () => {
    expect(beforeCursorWhere("file-created-desc", cursor)).toEqual({
      OR: [
        { fileCreatedAt: { gt: cursor.fileCreatedAt } },
        { AND: [{ fileCreatedAt: cursor.fileCreatedAt }, { id: { gt: "p5" } }] },
      ],
    });
  });

  it("file-created-asc: keys on fileCreatedAt, directions flipped", () => {
    expect(beforeCursorWhere("file-created-asc", cursor)).toEqual({
      OR: [
        { fileCreatedAt: { lt: cursor.fileCreatedAt } },
        { AND: [{ fileCreatedAt: cursor.fileCreatedAt }, { id: { lt: "p5" } }] },
      ],
    });
  });
});

describe("locatePhoto", () => {
  function db(opts: { row: typeof cursor | null; before: number; inScope: number }) {
    const counts: Array<Record<string, unknown>> = [];
    return {
      counts,
      photo: {
        findUnique: vi.fn(async () => opts.row),
        count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          counts.push(where);
          return JSON.stringify(where).includes('"OR"') ? opts.before : opts.inScope;
        }),
      },
    };
  }

  it("returns the before-count as the index when the photo is in scope", async () => {
    const fake = db({ row: cursor, before: 7, inScope: 1 });
    const idx = await locatePhoto("p5", { kind: "library", sort: "taken-desc" }, fake as never);
    expect(idx).toBe(7);
  });

  it("returns null when the photo does not exist", async () => {
    const fake = db({ row: null, before: 0, inScope: 0 });
    const idx = await locatePhoto("missing", { kind: "library", sort: "taken-desc" }, fake as never);
    expect(idx).toBeNull();
    expect(fake.photo.count).not.toHaveBeenCalled();
  });

  it("returns null when the photo is outside the scope", async () => {
    const fake = db({ row: cursor, before: 3, inScope: 0 });
    const idx = await locatePhoto("p5", { kind: "library", sort: "taken-desc" }, fake as never);
    expect(idx).toBeNull();
  });
});
