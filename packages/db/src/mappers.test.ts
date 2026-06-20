import { describe, expect, it } from "vitest";
import { MatchType, PhotoSource, RuleOp } from "@lumio/shared";
import { toAlbumDTO, toPhotoDTO, toTrashedPhotoDTO } from "./mappers.js";

describe("toPhotoDTO", () => {
  it("maps a Prisma photo row to a PhotoDTO with ISO dates", () => {
    const row = {
      id: "p1",
      path: "vacation/img1.jpg",
      source: "filesystem" as const,
      takenAt: new Date("2024-01-15T12:00:00.000Z"),
      sortDate: new Date("2024-01-15T12:00:00.000Z"),
      width: 800,
      height: 600,
      hash: "abc",
      thumbhash: null,
      fileSize: null,
      fileMtimeMs: null,
      exif: { cameraMake: "Lumio" },
      colorLabel: null,
      createdAt: new Date("2024-02-01T00:00:00.000Z"),
      updatedAt: new Date("2024-02-02T00:00:00.000Z"),
    };

    const dto = toPhotoDTO(row);

    expect(dto.id).toBe("p1");
    expect(dto.source).toBe(PhotoSource.filesystem);
    expect(dto.takenAt).toBe("2024-01-15T12:00:00.000Z");
    expect(dto.createdAt).toBe("2024-02-01T00:00:00.000Z");
    expect(dto.exif).toEqual({ cameraMake: "Lumio" });
  });

  it("maps a null takenAt to null", () => {
    const dto = toPhotoDTO({
      id: "p2",
      path: "x.jpg",
      source: "filesystem" as const,
      takenAt: null,
      sortDate: new Date("2024-02-01T00:00:00.000Z"),
      width: 1,
      height: 1,
      hash: null,
      thumbhash: null,
      fileSize: null,
      fileMtimeMs: null,
      exif: {},
      colorLabel: null,
      createdAt: new Date("2024-02-01T00:00:00.000Z"),
      updatedAt: new Date("2024-02-01T00:00:00.000Z"),
    });
    expect(dto.takenAt).toBeNull();
    expect(dto.hash).toBeNull();
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
    expect(dto.createdAt).toBe("2026-06-19T00:00:00.000Z");
    expect(dto.updatedAt).toBe("2026-06-19T00:00:00.000Z");
  });
});

describe("toAlbumDTO", () => {
  it("maps a regular album with null rules", () => {
    const dto = toAlbumDTO({
      id: "a1",
      name: "Vacation",
      isSmart: false,
      rules: null,
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
      createdAt: new Date("2024-02-01T00:00:00.000Z"),
      updatedAt: new Date("2024-02-01T00:00:00.000Z"),
    });
    expect(dto.isSmart).toBe(true);
    expect(dto.rules).toEqual(rules);
  });
});
