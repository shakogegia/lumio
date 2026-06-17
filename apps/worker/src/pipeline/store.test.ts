import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
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
  exif: { cameraMake: "Lumio" },
  thumbnail: Buffer.from("fake-webp-bytes"),
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
  it("upserts by path and writes the thumbnail named by id", async () => {
    const db = fakeDb("photo123");

    const result = await storePhoto(
      { path: "vacation/img.jpg", source: PhotoSource.filesystem, processed },
      { db: db as never, thumbnailsDir: dir },
    );

    expect(result.id).toBe("photo123");
    const onDisk = await readFile(path.join(dir, "photo123.webp"));
    expect(onDisk.equals(processed.thumbnail)).toBe(true);
    expect(db.calls).toHaveLength(1);
  });
});
