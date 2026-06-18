import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getPhotoNeighbors, listPhotos, purgeAllPhotos } from "./photos-service.js";

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

// Simulates Prisma cursor pagination over an array that is already in PHOTO_ORDER.
// Positive take = rows after the cursor; negative take = rows before it (returned
// in array order, matching Prisma's "paginate backwards").
function keysetDb(ordered: Array<{ id: string; path: string }>) {
  return {
    photo: {
      findMany: async (args: { cursor: { id: string }; skip: number; take: number }) => {
        const idx = ordered.findIndex((r) => r.id === args.cursor.id);
        if (idx === -1) return [];
        if (args.take >= 0) {
          return ordered.slice(idx + args.skip, idx + args.skip + args.take);
        }
        // skip:1 excludes the cursor itself; guard so the fake can't mask a skip change.
        if (args.skip !== 1) throw new Error(`expected skip:1, got skip:${args.skip}`);
        const end = idx;
        return ordered.slice(Math.max(0, end + args.take), end);
      },
    },
  };
}

// Wraps keysetDb so the same ordered set also answers album.findUnique with a
// regular (non-smart) album — exercises the albumId != null / albumPhotoWhere path.
function albumKeysetDb(albumId: string, ordered: Array<{ id: string; path: string }>) {
  return {
    ...keysetDb(ordered),
    album: {
      findUnique: async () => ({
        id: albumId,
        name: "Scoped",
        isSmart: false,
        rules: null,
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
        updatedAt: new Date("2024-01-01T00:00:00.000Z"),
      }),
    },
  };
}

const strip = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, path: `p${i}.jpg` }));

describe("getPhotoNeighbors", () => {
  it("returns the immediate prev/next and a centered strip (library scope)", async () => {
    const ordered = strip(5); // p0 (newest) .. p4 (oldest), already in PHOTO_ORDER
    const db = keysetDb(ordered);
    const n = await getPhotoNeighbors({ id: "p2", path: "p2.jpg" }, null, 10, db as never);
    expect(n.prevId).toBe("p1");
    expect(n.nextId).toBe("p3");
    expect(n.strip.map((s) => s.id)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
  });

  it("nulls prevId at the start and nextId at the end", async () => {
    const ordered = strip(3);
    const db = keysetDb(ordered);
    const first = await getPhotoNeighbors({ id: "p0", path: "p0.jpg" }, null, 10, db as never);
    expect(first.prevId).toBeNull();
    expect(first.nextId).toBe("p1");
    const last = await getPhotoNeighbors({ id: "p2", path: "p2.jpg" }, null, 10, db as never);
    expect(last.prevId).toBe("p1");
    expect(last.nextId).toBeNull();
  });

  it("clamps the window near an edge", async () => {
    const ordered = strip(10);
    const db = keysetDb(ordered);
    const n = await getPhotoNeighbors({ id: "p1", path: "p1.jpg" }, null, 2, db as never);
    // window=2: before is clamped to [p0], after is [p2, p3]
    expect(n.strip.map((s) => s.id)).toEqual(["p0", "p1", "p2", "p3"]);
    expect(n.prevId).toBe("p0");
    expect(n.nextId).toBe("p2");
  });

  it("returns a single-item strip with no neighbors when the photo is alone", async () => {
    const db = keysetDb(strip(1));
    const n = await getPhotoNeighbors({ id: "p0", path: "p0.jpg" }, null, 10, db as never);
    expect(n.prevId).toBeNull();
    expect(n.nextId).toBeNull();
    expect(n.strip.map((s) => s.id)).toEqual(["p0"]);
  });

  it("degrades to a single-item strip when the album is missing", async () => {
    const db = {
      album: { findUnique: async () => null },
      photo: {
        findMany: async () => {
          throw new Error("should not query photos");
        },
      },
    };
    const n = await getPhotoNeighbors({ id: "p2", path: "p2.jpg" }, "ghost", 10, db as never);
    expect(n).toEqual({ prevId: null, nextId: null, strip: [{ id: "p2", path: "p2.jpg" }] });
  });

  it("scopes neighbors to an album (regular album)", async () => {
    const ordered = strip(5); // the album's photos, already in PHOTO_ORDER
    const db = albumKeysetDb("alb1", ordered);
    const n = await getPhotoNeighbors({ id: "p2", path: "p2.jpg" }, "alb1", 10, db as never);
    expect(n.prevId).toBe("p1");
    expect(n.nextId).toBe("p3");
    expect(n.strip.map((s) => s.id)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
  });

  it("scopes neighbors to a smart album (rule-based where, no throw)", async () => {
    const ordered = strip(5); // the photos the smart rule matches, in PHOTO_ORDER
    const db = {
      ...keysetDb(ordered),
      album: {
        findUnique: async () => ({
          id: "smart1",
          name: "Smart",
          isSmart: true,
          rules: {
            match: "all",
            rules: [{ field: "exif.cameraModel", op: "eq", value: "TestCam" }],
          },
          createdAt: new Date("2024-01-01T00:00:00.000Z"),
          updatedAt: new Date("2024-01-01T00:00:00.000Z"),
        }),
      },
    };
    const n = await getPhotoNeighbors({ id: "p2", path: "p2.jpg" }, "smart1", 10, db as never);
    expect(n.prevId).toBe("p1");
    expect(n.nextId).toBe("p3");
    expect(n.strip.map((s) => s.id)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
  });
});
