import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Prisma } from "@lumio/db";
import { PhotoSource } from "@lumio/shared";
import { storePhoto } from "./store.js";
import type { ProcessedPhoto } from "./process.js";

const dir = await mkdtemp(path.join(tmpdir(), "lumio-store-"));
afterAll(async () => rm(dir, { recursive: true, force: true }));

const processed: ProcessedPhoto = {
  width: 100,
  height: 80,
  takenAt: new Date("2024-03-14T09:26:53.000Z"),
  hash: "deadbeef",
  thumbhash: "AAAA",
  exif: { cameraMake: "Lumio" },
  thumbnail: Buffer.from("fake-webp-bytes"),
  display: Buffer.from("fake-display-bytes"),
};

function fakeDb(returnedId: string) {
  const calls: unknown[] = [];
  return {
    calls,
    photo: {
      upsert: async (args: unknown) => {
        calls.push(args);
        return { id: returnedId };
      },
    },
  };
}

describe("storePhoto", () => {
  it("upserts by path and writes the thumbnail and display named by id", async () => {
    const db = fakeDb("photo123");
    const thumbs = path.join(dir, "thumbs");
    const displays = path.join(dir, "displays");

    const result = await storePhoto(
      {
        path: "vacation/img.jpg",
        source: PhotoSource.filesystem,
        processed,
        fileSize: 12345,
        fileMtimeMs: 1710408413000.5,
      },
      { db: db as never, thumbnailsDir: thumbs, displaysDir: displays },
    );

    expect(result.id).toBe("photo123");
    const thumbOnDisk = await readFile(path.join(thumbs, "photo123.webp"));
    expect(thumbOnDisk.equals(processed.thumbnail)).toBe(true);
    const displayOnDisk = await readFile(path.join(displays, "photo123.webp"));
    expect(displayOnDisk.equals(processed.display)).toBe(true);
    expect(db.calls).toHaveLength(1);

    const args = db.calls[0] as {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(args.create.fileSize).toBe(12345);
    expect(args.create.fileMtimeMs).toBe(1710408413000.5);
    expect(args.update.fileSize).toBe(12345);
    expect(args.update.fileMtimeMs).toBe(1710408413000.5);
  });

  it("sets source on create only, never on update (provenance is immutable)", async () => {
    const db = fakeDb("photo123");
    await storePhoto(
      {
        path: "vacation/img.jpg",
        source: PhotoSource.upload,
        processed,
        fileSize: 1,
        fileMtimeMs: 1,
      },
      { db: db as never, thumbnailsDir: path.join(dir, "t2"), displaysDir: path.join(dir, "d2") },
    );

    const args = db.calls[0] as {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(args.create.source).toBe(PhotoSource.upload);
    expect(args.update).not.toHaveProperty("source");
  });

  it("clears edits on update (a re-import replaces stale recipes) but not on create", async () => {
    const db = fakeDb("photo123");
    await storePhoto(
      {
        path: "vacation/img.jpg",
        source: PhotoSource.filesystem,
        processed,
        fileSize: 1,
        fileMtimeMs: 1,
      },
      { db: db as never, thumbnailsDir: path.join(dir, "t3"), displaysDir: path.join(dir, "d3") },
    );

    const args = db.calls[0] as {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    // Prisma's JsonNull sentinel is the only way to clear a Json column.
    expect(args.update.edits).toBe(Prisma.JsonNull);
    expect(args.create).not.toHaveProperty("edits");
  });
});
