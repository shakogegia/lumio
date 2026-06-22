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
        catalogId: "cat1",
        path: "vacation/img.jpg",
        source: PhotoSource.filesystem,
        processed,
        fileSize: 12345,
        fileMtimeMs: 1710408413000.5,
        fileBirthtimeMs: 1700000000000,
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
      where: Record<string, unknown>;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(args.where).toEqual({ catalogId_path: { catalogId: "cat1", path: "vacation/img.jpg" } });
    expect(args.create.fileSize).toBe(12345);
    expect(args.create.fileMtimeMs).toBe(1710408413000.5);
    expect(args.update.fileSize).toBe(12345);
    expect(args.update.fileMtimeMs).toBe(1710408413000.5);
  });

  it("sets source on create only, never on update (provenance is immutable)", async () => {
    const db = fakeDb("photo123");
    await storePhoto(
      {
        catalogId: "cat1",
        path: "vacation/img.jpg",
        source: PhotoSource.upload,
        processed,
        fileSize: 1,
        fileMtimeMs: 1,
        fileBirthtimeMs: 1700000000000,
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
        catalogId: "cat1",
        path: "vacation/img.jpg",
        source: PhotoSource.filesystem,
        processed,
        fileSize: 1,
        fileMtimeMs: 1,
        fileBirthtimeMs: 1700000000000,
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

  it("derives fileModifiedAt from fileMtimeMs and uses takenAt for sortDate when present", async () => {
    const db = fakeDb("p");
    await storePhoto(
      {
        catalogId: "cat1",
        path: "with-exif.jpg",
        source: PhotoSource.filesystem,
        processed, // processed.takenAt = 2024-03-14T09:26:53.000Z
        fileSize: 1,
        fileMtimeMs: 1710408413000.5,
        fileBirthtimeMs: 1710408000000,
      },
      { db: db as never, thumbnailsDir: path.join(dir, "te"), displaysDir: path.join(dir, "de") },
    );

    const args = db.calls[0] as {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(args.create.fileModifiedAt).toEqual(new Date(1710408413000.5));
    expect(args.update.fileModifiedAt).toEqual(new Date(1710408413000.5));
    expect(args.create.fileCreatedAt).toEqual(new Date(1710408000000));
    expect(args.update.fileCreatedAt).toEqual(new Date(1710408000000));
    // takenAt wins over the file date when EXIF has a capture date.
    expect(args.create.sortDate).toEqual(processed.takenAt);
    expect(args.update.sortDate).toEqual(processed.takenAt);
  });

  it("falls back to the earliest of created/modified for sortDate when takenAt is null (created earlier)", async () => {
    const db = fakeDb("p");
    await storePhoto(
      {
        catalogId: "cat1",
        path: "no-exif-a.png",
        source: PhotoSource.filesystem,
        processed: { ...processed, takenAt: null },
        fileSize: 1,
        fileMtimeMs: 1710408413000, // modified later
        fileBirthtimeMs: 1700000000000, // created earlier
      },
      { db: db as never, thumbnailsDir: path.join(dir, "tna"), displaysDir: path.join(dir, "dna") },
    );
    const args = db.calls[0] as { create: Record<string, unknown> };
    expect(args.create.fileCreatedAt).toEqual(new Date(1700000000000));
    expect(args.create.fileModifiedAt).toEqual(new Date(1710408413000));
    expect(args.create.sortDate).toEqual(new Date(1700000000000)); // earliest wins
  });

  it("falls back to the earliest of created/modified for sortDate when takenAt is null (modified earlier)", async () => {
    const db = fakeDb("p");
    await storePhoto(
      {
        catalogId: "cat1",
        path: "no-exif-b.png",
        source: PhotoSource.filesystem,
        processed: { ...processed, takenAt: null },
        fileSize: 1,
        fileMtimeMs: 1700000000000, // modified earlier
        fileBirthtimeMs: 1710408413000, // created later
      },
      { db: db as never, thumbnailsDir: path.join(dir, "tnb"), displaysDir: path.join(dir, "dnb") },
    );
    const args = db.calls[0] as { create: Record<string, unknown> };
    expect(args.create.fileCreatedAt).toEqual(new Date(1710408413000)); // created later
    expect(args.create.fileModifiedAt).toEqual(new Date(1700000000000)); // modified earlier
    expect(args.create.sortDate).toEqual(new Date(1700000000000)); // earliest (modified) wins
  });

  it("upserts by (catalogId, path) and stores catalogId on create", async () => {
    const calls: any[] = [];
    const db = { photo: { upsert: async (args: any) => { calls.push(args); return { id: "p1" }; } } };
    await storePhoto(
      { catalogId: "cat1", path: "2024/a.jpg", source: PhotoSource.filesystem, processed, fileSize: 1, fileMtimeMs: 2, fileBirthtimeMs: 3 },
      { db: db as never, thumbnailsDir: path.join(dir, "tc"), displaysDir: path.join(dir, "dc") },
    );
    expect(calls[0].where).toEqual({ catalogId_path: { catalogId: "cat1", path: "2024/a.jpg" } });
    expect(calls[0].create.catalogId).toBe("cat1");
  });
});
