import { describe, expect, it, vi } from "vitest";
import { finalizeTrash } from "./finalize-trash.js";

function photoRow(id: string) {
  return {
    id, path: `${id}.jpg`, source: "filesystem", takenAt: null, sortDate: new Date(0),
    width: 1, height: 1, hash: null, thumbhash: null, exif: {}, colorLabel: null,
    albums: [{ albumId: "a1" }],
  };
}

describe("finalizeTrash", () => {
  it("drains all pending photos: snapshot, move files, delete row; loops until empty", async () => {
    const pending = [photoRow("p1"), photoRow("p2")];
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(pending[0])
      .mockResolvedValueOnce(pending[1])
      .mockResolvedValueOnce(null);
    const upsert = vi.fn().mockResolvedValue({});
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = { photo: { findFirst, deleteMany }, trashedPhoto: { upsert } } as never;
    const moveFile = vi.fn().mockResolvedValue(undefined);
    const onProgress = vi.fn();

    const result = await finalizeTrash({
      db, catalogId: "cat1", photosDir: "/photos", cacheDir: "/cache", trashDir: "/trash", moveFile,
    }, onProgress);

    expect(result).toEqual({ finalized: 2 });

    // Snapshot taken via upsert (idempotent), with the data under the `create` key.
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "p1" },
        create: expect.objectContaining({ id: "p1", albumIds: ["a1"] }),
        update: {},
      }),
    );

    // The three move paths for p1, in order.
    expect(moveFile).toHaveBeenCalledTimes(6); // 3 files × 2 photos
    expect(moveFile).toHaveBeenNthCalledWith(1, "/cache/thumbnails/p1.webp", "/trash/thumbnails/p1.webp");
    expect(moveFile).toHaveBeenNthCalledWith(2, "/cache/displays/p1.webp", "/trash/displays/p1.webp");
    expect(moveFile).toHaveBeenNthCalledWith(3, "/photos/p1.jpg", "/trash/originals/p1.jpg");

    // Row deleted for both photos, scoped by catalog, only when still pending.
    expect(deleteMany).toHaveBeenCalledTimes(2);
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: "p1", catalogId: "cat1", trashedAt: { not: null } } });
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: "p2", catalogId: "cat1", trashedAt: { not: null } } });

    // Sequencing for p1: snapshot → move → delete.
    expect(upsert.mock.invocationCallOrder[0]!).toBeLessThan(moveFile.mock.invocationCallOrder[0]!);
    expect(moveFile.mock.invocationCallOrder[0]!).toBeLessThan(deleteMany.mock.invocationCallOrder[0]!);

    // Progress reported after each photo.
    expect(onProgress).toHaveBeenNthCalledWith(1, 1);
    expect(onProgress).toHaveBeenNthCalledWith(2, 2);
  });

  it("skips a photo whose trashedAt was cleared (undo) — only finds still-pending rows", async () => {
    const findFirst = vi.fn().mockResolvedValueOnce(null);
    const db = { photo: { findFirst, deleteMany: vi.fn() }, trashedPhoto: { upsert: vi.fn(), deleteMany: vi.fn() } } as never;
    const result = await finalizeTrash({
      db, catalogId: "cat1", photosDir: "/p", cacheDir: "/c", trashDir: "/t", moveFile: vi.fn(),
    });
    expect(result).toEqual({ finalized: 0 });
  });

  it("rolls back when the photo was restored (un-marked) mid-finalize", async () => {
    // Worker found the photo pending, snapshotted + moved files, but by the time it
    // tries to delete, a concurrent restore has already cleared trashedAt → count: 0.
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(photoRow("p1")) // first iteration: found
      .mockResolvedValueOnce(null);          // second iteration: nothing left
    const photoDeleteMany = vi.fn().mockResolvedValue({ count: 0 }); // restore beat us
    const trashedDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = {
      photo: { findFirst, deleteMany: photoDeleteMany },
      trashedPhoto: { upsert: vi.fn().mockResolvedValue({}), deleteMany: trashedDeleteMany },
    } as never;
    const moveFile = vi.fn().mockResolvedValue(undefined);

    const result = await finalizeTrash({
      db, catalogId: "cat1", photosDir: "/photos", cacheDir: "/cache", trashDir: "/trash", moveFile,
    });

    // Photo was not finalized — restore already handled it.
    expect(result).toEqual({ finalized: 0 });

    // 3 forward moves (to trash) + 3 rollback moves (back from trash) = 6 total.
    expect(moveFile).toHaveBeenCalledTimes(6);
    // Forward moves (to trash).
    expect(moveFile).toHaveBeenNthCalledWith(1, "/cache/thumbnails/p1.webp", "/trash/thumbnails/p1.webp");
    expect(moveFile).toHaveBeenNthCalledWith(2, "/cache/displays/p1.webp", "/trash/displays/p1.webp");
    expect(moveFile).toHaveBeenNthCalledWith(3, "/photos/p1.jpg", "/trash/originals/p1.jpg");
    // Rollback moves (back from trash).
    expect(moveFile).toHaveBeenNthCalledWith(4, "/trash/thumbnails/p1.webp", "/cache/thumbnails/p1.webp");
    expect(moveFile).toHaveBeenNthCalledWith(5, "/trash/displays/p1.webp", "/cache/displays/p1.webp");
    expect(moveFile).toHaveBeenNthCalledWith(6, "/trash/originals/p1.jpg", "/photos/p1.jpg");

    // Orphan snapshot dropped.
    expect(trashedDeleteMany).toHaveBeenCalledWith({ where: { id: "p1", catalogId: "cat1" } });
  });
});
