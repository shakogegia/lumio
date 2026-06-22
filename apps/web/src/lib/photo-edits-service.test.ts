import { describe, expect, it, vi } from "vitest";
import { applyPhotoEdits } from "./photo-edits-service.js";

// We mock the heavy I/O modules so the unit test runs without real files or encoders.
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
  rm: vi.fn(async () => undefined),
}));

vi.mock("@lumio/ingest", () => ({
  decodeToSharpInput: vi.fn(async () => ({
    input: { data: Buffer.from("FAKE") },
    cleanup: vi.fn(async () => undefined),
  })),
  buildRenditions: vi.fn(async () => ({
    display: Buffer.from("DISPLAY"),
    thumbnail: Buffer.from("THUMB"),
    thumbhash: "hash",
    width: 100,
    height: 100,
  })),
}));

vi.mock("@/lib/paths", () => ({
  thumbnailPath: vi.fn((catalogId: string, id: string) => `/cache/${catalogId}/thumbnails/${id}.webp`),
  editedDisplayPath: vi.fn((catalogId: string, id: string) => `/cache/${catalogId}/displays-edited/${id}.webp`),
  originalPath: vi.fn((catalog: { path: string }, relPath: string) => `${catalog.path}/${relPath}`),
}));

const CAT_OBJ = { id: "cat1", path: "/media/cat1" };
const PHOTO_ID = "photo-abc";

function makePhotoRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PHOTO_ID,
    catalogId: CAT_OBJ.id,
    path: "2024/photo.jpg",
    source: "filesystem",
    takenAt: new Date("2024-01-01T00:00:00.000Z"),
    sortDate: new Date("2024-01-01T00:00:00.000Z"),
    fileModifiedAt: new Date("2024-01-01T00:00:00.000Z"),
    fileCreatedAt: new Date("2024-01-01T00:00:00.000Z"),
    width: 100,
    height: 100,
    hash: null,
    exif: {},
    colorLabel: null,
    isFavorite: false,
    thumbhash: null,
    edits: null,
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("applyPhotoEdits", () => {
  it("returns null for a photo id that does not belong to the given catalog", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const update = vi.fn();
    const db = { photo: { findFirst, update } };

    const result = await applyPhotoEdits(CAT_OBJ, "foreign-id", null, db as never);

    expect(result).toBeNull();
    // Must scope the lookup by both id and catalogId.
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "foreign-id", catalogId: CAT_OBJ.id } }),
    );
    // No update should have been attempted.
    expect(update).not.toHaveBeenCalled();
  });

  it("scopes the findFirst query to the catalog", async () => {
    const photoRow = makePhotoRow();
    const findFirst = vi.fn().mockResolvedValue(photoRow);
    const update = vi.fn().mockResolvedValue(photoRow);
    const db = { photo: { findFirst, update } };

    await applyPhotoEdits(CAT_OBJ, PHOTO_ID, null, db as never);

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: PHOTO_ID, catalogId: CAT_OBJ.id } }),
    );
  });
});
