import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { purgeAllPhotos, purgeTrash } from "./purge.js";

async function photoDirs() {
  const photosDir = await mkdtemp(path.join(tmpdir(), "lumio-photos-"));
  const cacheDir = await mkdtemp(path.join(tmpdir(), "lumio-cache-"));
  await mkdir(path.join(cacheDir, "thumbnails"), { recursive: true });
  await mkdir(path.join(cacheDir, "displays"), { recursive: true });
  return { photosDir, cacheDir };
}

describe("purgeAllPhotos", () => {
  it("removes originals + renditions then deletes every row", async () => {
    const { photosDir, cacheDir } = await photoDirs();
    await writeFile(path.join(photosDir, "a.jpg"), "orig");
    await writeFile(path.join(cacheDir, "thumbnails", "a.webp"), "t");
    await writeFile(path.join(cacheDir, "displays", "a.webp"), "d");

    const db = {
      photo: {
        findMany: vi.fn().mockResolvedValue([{ id: "a", path: "a.jpg" }]),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const result = await purgeAllPhotos({ db: db as never, photosDir, cacheDir });

    expect(result).toEqual({ deleted: 1 });
    expect(existsSync(path.join(photosDir, "a.jpg"))).toBe(false);
    expect(existsSync(path.join(cacheDir, "thumbnails", "a.webp"))).toBe(false);
    expect(db.photo.deleteMany).toHaveBeenCalledWith({});
  });
});

describe("purgeTrash", () => {
  it("removes trashed files (all) and deletes the rows", async () => {
    const trashDir = await mkdtemp(path.join(tmpdir(), "lumio-trash-"));
    await mkdir(path.join(trashDir, "originals"), { recursive: true });
    await mkdir(path.join(trashDir, "thumbnails"), { recursive: true });
    await mkdir(path.join(trashDir, "displays"), { recursive: true });
    await writeFile(path.join(trashDir, "originals", "a.jpg"), "orig");
    await writeFile(path.join(trashDir, "thumbnails", "a.webp"), "t");

    const db = {
      trashedPhoto: {
        findMany: vi.fn().mockResolvedValue([{ id: "a", originalPath: "a.jpg" }]),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const result = await purgeTrash(undefined, { db: db as never, trashDir });

    expect(result).toEqual({ deleted: 1 });
    expect(await readdir(path.join(trashDir, "originals"))).toEqual([]);
    expect(db.trashedPhoto.deleteMany).toHaveBeenCalledWith({ where: {} });
  });
});
