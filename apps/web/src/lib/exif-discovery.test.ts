import { describe, expect, it, vi } from "vitest";
import { distinctValues } from "./exif-discovery";

describe("distinctValues (promoted column)", () => {
  it("groupBy a column → [{ value, count }] sorted by count desc", async () => {
    const db = {
      photo: {
        groupBy: vi.fn(async () => [
          { cameraModel: "iPhone 15", _count: { _all: 3 } },
          { cameraModel: "ILCE-7M4", _count: { _all: 5 } },
          { cameraModel: null, _count: { _all: 2 } },
        ]),
      },
    };
    const out = await distinctValues("camera", db as never);
    expect(out).toEqual([
      { value: "ILCE-7M4", count: 5 },
      { value: "iPhone 15", count: 3 },
    ]);
    expect(db.photo.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ["cameraModel"], _count: { _all: true } }),
    );
  });

  it("coerces Date column values to ISO strings", async () => {
    const db = {
      photo: {
        groupBy: vi.fn(async () => [
          { takenAt: new Date("2024-01-15T10:30:00.000Z"), _count: { _all: 4 } },
        ]),
      },
    };
    const out = await distinctValues("takenAt", db as never);
    expect(out).toEqual([{ value: "2024-01-15T10:30:00.000Z", count: 4 }]);
  });
});
