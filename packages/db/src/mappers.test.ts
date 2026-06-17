import { describe, expect, it } from "vitest";
import { PhotoSource } from "@lumio/shared";
import { toPhotoDTO } from "./mappers.js";

describe("toPhotoDTO", () => {
  it("maps a Prisma photo row to a PhotoDTO with ISO dates", () => {
    const row = {
      id: "p1",
      path: "vacation/img1.jpg",
      source: "filesystem" as const,
      takenAt: new Date("2024-01-15T12:00:00.000Z"),
      width: 800,
      height: 600,
      hash: "abc",
      exif: { cameraMake: "Lumio" },
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
      width: 1,
      height: 1,
      hash: null,
      exif: {},
      createdAt: new Date("2024-02-01T00:00:00.000Z"),
      updatedAt: new Date("2024-02-01T00:00:00.000Z"),
    });
    expect(dto.takenAt).toBeNull();
    expect(dto.hash).toBeNull();
  });
});
