import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listPhotos, purgeAllPhotos } from "./photos-service.js";

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

describe("purgeAllPhotos", () => {
  it("deletes originals + cached files and wipes the table", async () => {
    const photosDir = await mkdtemp(path.join(tmpdir(), "lumio-photos-"));
    const cacheDir = await mkdtemp(path.join(tmpdir(), "lumio-cache-"));
    await mkdir(path.join(cacheDir, "thumbnails"), { recursive: true });
    await mkdir(path.join(cacheDir, "displays"), { recursive: true });

    const photos = [
      { id: "a", path: "a.jpg" },
      { id: "b", path: "b.jpg" },
    ];
    const original = (p: (typeof photos)[number]) => path.join(photosDir, p.path);
    const thumb = (p: (typeof photos)[number]) => path.join(cacheDir, "thumbnails", `${p.id}.webp`);
    const display = (p: (typeof photos)[number]) => path.join(cacheDir, "displays", `${p.id}.webp`);

    for (const p of photos) {
      await writeFile(original(p), "orig");
      await writeFile(thumb(p), "thumb");
      await writeFile(display(p), "display");
    }

    let deleteManyCalled = false;
    const db = {
      photo: {
        findMany: async () => photos,
        deleteMany: async () => {
          deleteManyCalled = true;
          return { count: photos.length };
        },
      },
    };

    const result = await purgeAllPhotos({ db: db as never, photosDir, cacheDir });

    expect(result).toEqual({ deleted: 2 });
    expect(deleteManyCalled).toBe(true);
    for (const p of photos) {
      expect(existsSync(original(p))).toBe(false);
      expect(existsSync(thumb(p))).toBe(false);
      expect(existsSync(display(p))).toBe(false);
    }
  });

  it("ignores already-missing files", async () => {
    const photosDir = await mkdtemp(path.join(tmpdir(), "lumio-photos-"));
    const cacheDir = await mkdtemp(path.join(tmpdir(), "lumio-cache-"));
    const db = {
      photo: {
        findMany: async () => [{ id: "gone", path: "gone.jpg" }],
        deleteMany: async () => ({ count: 1 }),
      },
    };

    const result = await purgeAllPhotos({ db: db as never, photosDir, cacheDir });
    expect(result).toEqual({ deleted: 1 });
  });
});
