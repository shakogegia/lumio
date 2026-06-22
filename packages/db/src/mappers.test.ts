import { describe, expect, it } from "vitest";
import { MatchType, PhotoSource, RuleOp } from "@lumio/shared";
import { toAlbumDTO, toPhotoDTO, toTrashedPhotoDTO } from "./mappers.js";

const baseRow = {
  id: "p1",
  path: "vacation/img1.jpg",
  source: "filesystem" as const,
  takenAt: new Date("2024-01-15T12:00:00.000Z"),
  sortDate: new Date("2024-01-15T12:00:00.000Z"),
  width: 800,
  height: 600,
  hash: "abc",
  thumbhash: null,
  fileSize: 12345,
  fileMtimeMs: 1710408413000.5,
  fileModifiedAt: new Date("2024-01-20T08:00:00.000Z"),
  fileCreatedAt: new Date("2024-01-18T08:00:00.000Z"),
  exif: { cameraMake: "Lumio" },
  colorLabel: null,
  isFavorite: false,
  createdAt: new Date("2024-02-01T00:00:00.000Z"),
  updatedAt: new Date("2024-02-02T00:00:00.000Z"),
  edits: null,
};

describe("toPhotoDTO", () => {
  it("maps a Prisma photo row to a PhotoDTO with ISO dates", () => {
    const dto = toPhotoDTO({ ...baseRow, isFavorite: true } as any);

    expect(dto.id).toBe("p1");
    expect(dto.source).toBe(PhotoSource.filesystem);
    expect(dto.takenAt).toBe("2024-01-15T12:00:00.000Z");
    expect(dto.fileModifiedAt).toBe("2024-01-20T08:00:00.000Z");
    expect(dto.fileCreatedAt).toBe("2024-01-18T08:00:00.000Z");
    expect(dto.createdAt).toBe("2024-02-01T00:00:00.000Z");
    expect(dto.exif).toEqual({ cameraMake: "Lumio" });
    expect(dto.isFavorite).toBe(true);
  });

  it("maps a null takenAt to null", () => {
    const dto = toPhotoDTO({
      ...baseRow,
      id: "p2",
      path: "x.jpg",
      takenAt: null,
      hash: null,
      exif: {},
    } as any);
    expect(dto.takenAt).toBeNull();
    expect(dto.hash).toBeNull();
    expect(dto.isFavorite).toBe(false);
  });

  it("maps a valid edits recipe", () => {
    const dto = toPhotoDTO({ ...baseRow, edits: { rotate: 90, flipH: true, flipV: false } } as any);
    // coercePhotoEdits normalizes to the full recipe shape, defaulting the
    // crop/straighten fields added by the crop & straighten feature.
    expect(dto.edits).toEqual({ rotate: 90, flipH: true, flipV: false, straighten: 0, crop: null });
  });
  it("maps null edits to null", () => {
    const dto = toPhotoDTO({ ...baseRow, edits: null } as any);
    expect(dto.edits).toBeNull();
  });
  it("maps malformed edits to null", () => {
    const dto = toPhotoDTO({ ...baseRow, edits: { rotate: 45 } } as any);
    expect(dto.edits).toBeNull();
  });

  it("round-trips color fields and omits neutral ones", () => {
    const dto = toPhotoDTO({
      ...baseRow,
      edits: { rotate: 0, flipH: false, flipV: false, brightness: 40, vignette: 0 },
    } as any);
    expect(dto.edits).toEqual({
      rotate: 0, flipH: false, flipV: false, straighten: 0, crop: null, brightness: 40,
    });
  });

  it("clamps malformed color to neutral (drops it)", () => {
    const dto = toPhotoDTO({
      ...baseRow,
      edits: { rotate: 0, flipH: false, flipV: false, contrast: 9999 },
    } as any);
    expect(dto.edits).toEqual({
      rotate: 0, flipH: false, flipV: false, straighten: 0, crop: null, contrast: 100,
    });
  });
});

describe("toTrashedPhotoDTO", () => {
  it("maps a trashed row to a PhotoDTO using originalPath + deletedAt", () => {
    const dto = toTrashedPhotoDTO({
      id: "t1",
      originalPath: "2026/06-19/x.jpg",
      source: "filesystem",
      takenAt: new Date("2024-01-01T00:00:00.000Z"),
      sortDate: new Date("2024-01-01T00:00:00.000Z"),
      width: 4,
      height: 3,
      hash: null,
      exif: {},
      colorLabel: "blue",
      albumIds: ["a1"],
      deletedAt: new Date("2026-06-19T00:00:00.000Z"),
    } as never);
    expect(dto.id).toBe("t1");
    expect(dto.path).toBe("2026/06-19/x.jpg");
    expect(dto.width).toBe(4);
    expect(dto.colorLabel).toBe("blue");
    expect(dto.isFavorite).toBe(false);
    expect(dto.createdAt).toBe("2026-06-19T00:00:00.000Z");
    expect(dto.updatedAt).toBe("2026-06-19T00:00:00.000Z");
    expect(dto.fileModifiedAt).toBeNull();
    expect(dto.fileCreatedAt).toBeNull();
  });
});

describe("toAlbumDTO", () => {
  it("maps a regular album with null rules", () => {
    const dto = toAlbumDTO({
      id: "a1",
      name: "Vacation",
      isSmart: false,
      rules: null,
      coverPhotoId: null,
      folderId: null,
      catalogId: "cat1",
      createdAt: new Date("2024-02-01T00:00:00.000Z"),
      updatedAt: new Date("2024-02-02T00:00:00.000Z"),
    });
    expect(dto.id).toBe("a1");
    expect(dto.name).toBe("Vacation");
    expect(dto.isSmart).toBe(false);
    expect(dto.rules).toBeNull();
    expect(dto.createdAt).toBe("2024-02-01T00:00:00.000Z");
  });

  it("maps a smart album, passing rules JSON through", () => {
    const rules = {
      match: MatchType.all,
      rules: [{ field: "exif.cameraModel", op: RuleOp.eq, value: "iPhone" }],
    };
    const dto = toAlbumDTO({
      id: "a2",
      name: "iPhone shots",
      isSmart: true,
      rules: rules as never,
      coverPhotoId: null,
      folderId: null,
      catalogId: "cat1",
      createdAt: new Date("2024-02-01T00:00:00.000Z"),
      updatedAt: new Date("2024-02-01T00:00:00.000Z"),
    });
    expect(dto.isSmart).toBe(true);
    expect(dto.rules).toEqual(rules);
  });
});
