import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { desiredPath, previewReorganize, reorganizePhotos } from "./reorganize.js";

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

async function photosRoot() {
  return mkdtemp(path.join(tmpdir(), "lumio-reorg-"));
}

function moverDb(rows: unknown[], findUnique = vi.fn().mockResolvedValue(null)) {
  return {
    photo: {
      findMany: vi.fn().mockResolvedValue(rows),
      findUnique,
      update: vi.fn().mockResolvedValue({}),
    },
  };
}

describe("reorganizePhotos", () => {
  it("repoints the row then moves the file to its template path", async () => {
    const photosDir = await photosRoot();
    await mkdir(path.join(photosDir, "incoming"), { recursive: true });
    await writeFile(path.join(photosDir, "incoming/IMG.jpg"), "data");
    const db = moverDb([row({ path: "incoming/IMG.jpg" })]);

    const res = await reorganizePhotos({
      db: db as never,
      catalogId: "cat1",
      photosDir,
      uploadTemplate: TEMPLATE,
      includeFilesystem: true,
    });

    expect(res).toEqual({ moved: 1, skipped: 0, failed: 0 });
    expect(existsSync(path.join(photosDir, "2024/03-14/IMG.jpg"))).toBe(true);
    expect(existsSync(path.join(photosDir, "incoming/IMG.jpg"))).toBe(false);
    expect(await readFile(path.join(photosDir, "2024/03-14/IMG.jpg"), "utf8")).toBe("data");
    expect(db.photo.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { path: "2024/03-14/IMG.jpg", dirPath: "2024/03-14" },
    });
  });

  it("skips a photo already at its template path", async () => {
    const photosDir = await photosRoot();
    await mkdir(path.join(photosDir, "2024/03-14"), { recursive: true });
    await writeFile(path.join(photosDir, "2024/03-14/IMG.jpg"), "data");
    const db = moverDb([row({ path: "2024/03-14/IMG.jpg" })]);

    const res = await reorganizePhotos({
      db: db as never,
      catalogId: "cat1",
      photosDir,
      uploadTemplate: TEMPLATE,
      includeFilesystem: true,
    });

    expect(res).toEqual({ moved: 0, skipped: 1, failed: 0 });
    expect(db.photo.update).not.toHaveBeenCalled();
  });

  it("suffixes -1 when the target path is already taken by another row", async () => {
    const photosDir = await photosRoot();
    await mkdir(path.join(photosDir, "incoming"), { recursive: true });
    await writeFile(path.join(photosDir, "incoming/IMG.jpg"), "data");
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({ id: "other" })
      .mockResolvedValue(null);
    const db = moverDb([row({ path: "incoming/IMG.jpg" })], findUnique);

    const res = await reorganizePhotos({
      db: db as never,
      catalogId: "cat1",
      photosDir,
      uploadTemplate: TEMPLATE,
      includeFilesystem: true,
    });

    expect(res.moved).toBe(1);
    expect(existsSync(path.join(photosDir, "2024/03-14/IMG-1.jpg"))).toBe(true);
    expect(db.photo.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { path: "2024/03-14/IMG-1.jpg", dirPath: "2024/03-14" },
    });
  });

  it("suffixes -1 when an unrelated file already occupies the target path on disk", async () => {
    const photosDir = await photosRoot();
    await mkdir(path.join(photosDir, "incoming"), { recursive: true });
    await writeFile(path.join(photosDir, "incoming/IMG.jpg"), "data");
    // A stray file already sits at the template target; no DB row points at it.
    await mkdir(path.join(photosDir, "2024/03-14"), { recursive: true });
    await writeFile(path.join(photosDir, "2024/03-14/IMG.jpg"), "stray");
    const db = moverDb([row({ path: "incoming/IMG.jpg" })]); // findUnique defaults to null

    const res = await reorganizePhotos({
      db: db as never,
      catalogId: "cat1",
      photosDir,
      uploadTemplate: TEMPLATE,
      includeFilesystem: true,
    });

    expect(res.moved).toBe(1);
    expect(existsSync(path.join(photosDir, "2024/03-14/IMG-1.jpg"))).toBe(true);
    expect(await readFile(path.join(photosDir, "2024/03-14/IMG.jpg"), "utf8")).toBe("stray");
    expect(db.photo.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { path: "2024/03-14/IMG-1.jpg", dirPath: "2024/03-14" },
    });
  });

  it("prunes directories left empty by the move", async () => {
    const photosDir = await photosRoot();
    await mkdir(path.join(photosDir, "incoming"), { recursive: true });
    await writeFile(path.join(photosDir, "incoming/IMG.jpg"), "data");
    const db = moverDb([row({ path: "incoming/IMG.jpg" })]);

    await reorganizePhotos({
      db: db as never,
      catalogId: "cat1",
      photosDir,
      uploadTemplate: TEMPLATE,
      includeFilesystem: true,
    });

    expect(existsSync(path.join(photosDir, "incoming"))).toBe(false);
    expect(existsSync(photosDir)).toBe(true);
  });

  it("counts a missing source file as failed without touching the DB", async () => {
    const photosDir = await photosRoot();
    const db = moverDb([row({ path: "incoming/GONE.jpg" })]);
    const warnings: string[] = [];

    const res = await reorganizePhotos({
      db: db as never,
      catalogId: "cat1",
      photosDir,
      uploadTemplate: TEMPLATE,
      includeFilesystem: true,
      onWarn: (m) => warnings.push(m),
    });

    expect(res).toEqual({ moved: 0, skipped: 0, failed: 1 });
    expect(db.photo.update).not.toHaveBeenCalled();
    expect(warnings.length).toBe(1);
  });

  it("reverts the row repoint when the rename fails", async () => {
    const photosDir = await photosRoot();
    await mkdir(path.join(photosDir, "incoming"), { recursive: true });
    await writeFile(path.join(photosDir, "incoming/IMG.jpg"), "data");
    // Make "2024" a FILE so mkdir of "2024/03-14" throws ENOTDIR.
    await writeFile(path.join(photosDir, "2024"), "i am a file");
    const db = moverDb([row({ path: "incoming/IMG.jpg" })]);

    const res = await reorganizePhotos({
      db: db as never,
      catalogId: "cat1",
      photosDir,
      uploadTemplate: TEMPLATE,
      includeFilesystem: true,
      onWarn: () => {},
    });

    expect(res).toEqual({ moved: 0, skipped: 0, failed: 1 });
    expect(existsSync(path.join(photosDir, "incoming/IMG.jpg"))).toBe(true);
    expect(db.photo.update).toHaveBeenLastCalledWith({
      where: { id: "p1" },
      data: { path: "incoming/IMG.jpg", dirPath: "incoming" },
    });
  });

  it("reports progress for every photo considered", async () => {
    const photosDir = await photosRoot();
    await mkdir(path.join(photosDir, "2024/03-14"), { recursive: true });
    await writeFile(path.join(photosDir, "2024/03-14/IMG.jpg"), "data");
    const db = moverDb([row({ path: "2024/03-14/IMG.jpg" })]);
    const progress: Array<[number, number]> = [];

    await reorganizePhotos({
      db: db as never,
      catalogId: "cat1",
      photosDir,
      uploadTemplate: TEMPLATE,
      includeFilesystem: true,
      onProgress: (p, t) => { progress.push([p, t]); },
    });

    expect(progress).toEqual([[1, 1]]);
  });
});
