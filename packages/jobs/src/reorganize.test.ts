import { describe, expect, it, vi } from "vitest";
import { desiredPath, previewReorganize } from "./reorganize.js";

const TEMPLATE = "{TAKEN_YYYY}/{TAKEN_MM}-{TAKEN_DD}/{filename}";

function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "p1",
    path: "incoming/IMG.jpg",
    takenAt: new Date("2024-03-14T09:00:00.000Z"),
    fileModifiedAt: new Date("2022-01-01T00:00:00.000Z"),
    fileCreatedAt: new Date("2021-01-01T00:00:00.000Z"),
    createdAt: new Date("2026-01-02T00:00:00.000Z"),
    ...over,
  };
}

describe("desiredPath", () => {
  it("uses takenAt for {TAKEN_*} and the file basename for {filename}", () => {
    expect(desiredPath(TEMPLATE, row() as never)).toBe("2024/03-14/IMG.jpg");
  });

  it("falls back to fileModifiedAt when takenAt is null", () => {
    expect(desiredPath(TEMPLATE, row({ takenAt: null }) as never)).toBe("2022/01-01/IMG.jpg");
  });

  it("resolves {NOW_*} from createdAt", () => {
    expect(desiredPath("{NOW_YYYY}/{filename}", row() as never)).toBe("2026/IMG.jpg");
  });
});

describe("previewReorganize", () => {
  it("counts only photos whose templated path differs from the current path", async () => {
    const findMany = vi.fn().mockResolvedValue([
      row({ id: "a", path: "incoming/IMG.jpg" }),          // → 2024/03-14/IMG.jpg (moves)
      row({ id: "b", path: "2024/03-14/OK.jpg", takenAt: new Date("2024-03-14T00:00:00.000Z") }), // already there
    ]);
    const db = { photo: { findMany } } as never;
    const res = await previewReorganize({ db, catalogId: "cat1", uploadTemplate: TEMPLATE, includeFilesystem: true });
    expect(res).toEqual({ total: 2, willMove: 1 });
  });

  it("scopes to non-trashed uploads when includeFilesystem is false", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const db = { photo: { findMany } } as never;
    await previewReorganize({ db, catalogId: "cat1", uploadTemplate: TEMPLATE, includeFilesystem: false });
    expect(findMany).toHaveBeenCalledWith({
      where: { catalogId: "cat1", trashedAt: null, source: "upload" },
      select: expect.anything(),
    });
  });

  it("includes all sources (no source filter) when includeFilesystem is true", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const db = { photo: { findMany } } as never;
    await previewReorganize({ db, catalogId: "cat1", uploadTemplate: TEMPLATE, includeFilesystem: true });
    expect(findMany).toHaveBeenCalledWith({
      where: { catalogId: "cat1", trashedAt: null },
      select: expect.anything(),
    });
  });
});
