import { describe, expect, it, vi } from "vitest";
import { applyPhotoEdits } from "./photo-edits-service.js";

vi.mock("@lumio/ingest", () => ({
  regenerateRenditions: vi.fn(async () => ({ thumbhash: "hash", width: 100, height: 100 })),
}));

vi.mock("@/lib/server/server-paths", () => ({
  catalogCacheDirs: vi.fn((catalogId: string) => ({
    thumbnailsDir: `/cache/${catalogId}/thumbnails`,
    displaysDir: `/cache/${catalogId}/displays`,
    editedDisplaysDir: `/cache/${catalogId}/displays-edited`,
  })),
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

  it("delegates renditions to @lumio/ingest and persists the returned dims/thumbhash", async () => {
    const { regenerateRenditions } = await import("@lumio/ingest");
    const photoRow = makePhotoRow();
    const findFirst = vi.fn().mockResolvedValue(photoRow);
    const update = vi.fn().mockResolvedValue({ ...photoRow, width: 100, height: 100, thumbhash: "hash" });
    const db = { photo: { findFirst, update } };
    const recipe = { rotate: 90 as const, flipH: false, flipV: false };

    await applyPhotoEdits(CAT_OBJ, PHOTO_ID, recipe, db as never);

    expect(regenerateRenditions).toHaveBeenCalledWith(
      `${CAT_OBJ.path}/2024/photo.jpg`,
      recipe,
      PHOTO_ID,
      {
        thumbnailsDir: `/cache/${CAT_OBJ.id}/thumbnails`,
        displaysDir: `/cache/${CAT_OBJ.id}/displays`,
        editedDisplaysDir: `/cache/${CAT_OBJ.id}/displays-edited`,
      },
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PHOTO_ID, catalogId: CAT_OBJ.id },
        data: expect.objectContaining({ width: 100, height: 100, thumbhash: "hash" }),
      }),
    );
  });

  it("reset (null edits) passes a null recipe and clears edits with Prisma.JsonNull", async () => {
    const { regenerateRenditions } = await import("@lumio/ingest");
    const { Prisma } = await import("@lumio/db");
    const photoRow = makePhotoRow({ edits: { rotate: 90, flipH: false, flipV: false } });
    const findFirst = vi.fn().mockResolvedValue(photoRow);
    const update = vi.fn().mockResolvedValue(photoRow);
    const db = { photo: { findFirst, update } };

    await applyPhotoEdits(CAT_OBJ, PHOTO_ID, null, db as never);

    expect(regenerateRenditions).toHaveBeenCalledWith(expect.any(String), null, PHOTO_ID, expect.any(Object));
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ edits: Prisma.JsonNull }) }),
    );
  });
});
