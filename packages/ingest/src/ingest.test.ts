import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { ingestPath, removePath } from "./ingest.js";

// Create temp directories for photos and thumbnails
const tmpBase = await mkdtemp(path.join(tmpdir(), "lumio-ingest-"));
const tmpPhotos = path.join(tmpBase, "photos");
const tmpThumbs = path.join(tmpBase, "thumbs");
const tmpDisplays = path.join(tmpBase, "displays");
const tmpEditedDisplays = path.join(tmpBase, "displays-edited");
await mkdir(tmpPhotos, { recursive: true });
await mkdir(tmpThumbs, { recursive: true });
await mkdir(tmpDisplays, { recursive: true });
await mkdir(tmpEditedDisplays, { recursive: true });

// Create a fixture image: sub/img.jpg with EXIF
const subDir = path.join(tmpPhotos, "sub");
await mkdir(subDir, { recursive: true });
const fixturePath = path.join(subDir, "img.jpg");
await sharp({ create: { width: 320, height: 240, channels: 3, background: "#123456" } })
  .withExif({
    IFD0: { Make: "Lumio", Model: "X" },
    IFD2: { DateTimeOriginal: "2024:03:14 09:26:53" },
  })
  .jpeg()
  .toFile(fixturePath);

afterAll(async () => rm(tmpBase, { recursive: true, force: true }));

describe("ingestPath", () => {
  it("calls upsert with the correct path and writes thumbnail + display named by id", async () => {
    const calls: unknown[] = [];
    const fakeDb = {
      photo: {
        upsert: async (args: unknown) => {
          calls.push(args);
          return { id: "pX" };
        },
      },
    };

    const result = await ingestPath("sub/img.jpg", {
      db: fakeDb as never,
      catalogId: "cat1",
      thumbnailsDir: tmpThumbs,
      displaysDir: tmpDisplays,
      photosDir: tmpPhotos,
    });

    expect(result).toEqual({ id: "pX" });
    expect(calls).toHaveLength(1);
    expect((calls[0] as { where: { catalogId_path: { catalogId: string; path: string } } }).where).toEqual({ catalogId_path: { catalogId: "cat1", path: "sub/img.jpg" } });

    const payload = calls[0] as {
      create: { fileSize: unknown; fileMtimeMs: unknown };
      update: { fileSize: unknown; fileMtimeMs: unknown };
    };
    expect(typeof payload.create.fileSize).toBe("number");
    expect(payload.create.fileSize).toBeGreaterThan(0);
    expect(typeof payload.create.fileMtimeMs).toBe("number");
    expect(payload.update.fileSize).toBe(payload.create.fileSize);
    expect(payload.update.fileMtimeMs).toBe(payload.create.fileMtimeMs);

    // Thumbnail and display should exist at <dir>/pX.webp
    await expect(access(path.join(tmpThumbs, "pX.webp"))).resolves.toBeUndefined();
    await expect(access(path.join(tmpDisplays, "pX.webp"))).resolves.toBeUndefined();
  });
});

describe("removePath", () => {
  it("deletes the DB row and removes the thumbnail + display files", async () => {
    const deleteCalls: unknown[] = [];

    // Pre-create the thumbnail and display so rm can remove them
    const thumbFile = path.join(tmpThumbs, "pX.webp");
    const displayFile = path.join(tmpDisplays, "pX.webp");
    for (const file of [thumbFile, displayFile]) {
      await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } })
        .webp()
        .toFile(file);
    }

    const fakeDb = {
      photo: {
        findUnique: async (_args: unknown) => ({ id: "pX" }),
        delete: async (args: unknown) => {
          deleteCalls.push(args);
          return { id: "pX" };
        },
      },
    };

    const result = await removePath("sub/img.jpg", {
      db: fakeDb as never,
      catalogId: "cat1",
      thumbnailsDir: tmpThumbs,
      displaysDir: tmpDisplays,
      editedDisplaysDir: tmpEditedDisplays,
    });

    expect(result).toBe(true);
    expect(deleteCalls).toHaveLength(1);
    expect((deleteCalls[0] as { where: { id: string } }).where).toEqual({ id: "pX" });

    // Thumbnail and display should be gone
    await expect(access(thumbFile)).rejects.toThrow();
    await expect(access(displayFile)).rejects.toThrow();
  });

  it("is a no-op when the path is not in the DB", async () => {
    const deleteCalls: unknown[] = [];

    const fakeDb = {
      photo: {
        findUnique: async (_args: unknown) => null,
        delete: async (args: unknown) => {
          deleteCalls.push(args);
          return { id: "noop" };
        },
      },
    };

    const result = await removePath("nonexistent/img.jpg", {
      db: fakeDb as never,
      catalogId: "cat1",
      thumbnailsDir: tmpThumbs,
      displaysDir: tmpDisplays,
      editedDisplaysDir: tmpEditedDisplays,
    });

    expect(result).toBe(false);
    expect(deleteCalls).toHaveLength(0);
  });
});
