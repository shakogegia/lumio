import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { MatchType, RuleOp } from "@lumio/shared";
import { buildPhotoWhere } from "./photo-where.js";

const now = new Date("2026-06-17T00:00:00.000Z");
const where = (rules: Parameters<typeof buildPhotoWhere>[0]["rules"], match = MatchType.all) =>
  buildPhotoWhere({ match, rules }, now);

describe("buildPhotoWhere", () => {
  it("empty rules → {} (whole library)", () => {
    expect(where([])).toEqual({});
  });

  it("promoted numeric range (iso between) → typed column predicate", () => {
    expect(where([{ field: "iso", op: RuleOp.between, value: [200, 1600] }])).toEqual({
      AND: [{ iso: { gte: 200, lte: 1600 } }],
    });
  });

  it("promoted gt/lt", () => {
    expect(where([{ field: "aperture", op: RuleOp.lte, value: 2.8 }])).toEqual({
      AND: [{ fNumber: { lte: 2.8 } }],
    });
  });

  it("string column contains is case-insensitive", () => {
    expect(where([{ field: "camera", op: RuleOp.contains, value: "sony" }])).toEqual({
      AND: [{ cameraModel: { contains: "sony", mode: "insensitive" } }],
    });
  });

  it("exists on a column → not null", () => {
    expect(where([{ field: "lens", op: RuleOp.exists }])).toEqual({
      AND: [{ lensModel: { not: null } }],
    });
  });

  it("hasGps eq true", () => {
    expect(where([{ field: "hasGps", op: RuleOp.eq, value: true }])).toEqual({
      AND: [{ hasGps: true }],
    });
  });

  it("takenAt between → ISO strings forwarded to the DateTime column", () => {
    expect(
      where([
        {
          field: "takenAt",
          op: RuleOp.between,
          value: ["2024-01-01T00:00:00.000Z", "2024-12-31T23:59:59.999Z"],
        },
      ]),
    ).toEqual({
      AND: [{ takenAt: { gte: "2024-01-01T00:00:00.000Z", lte: "2024-12-31T23:59:59.999Z" } }],
    });
  });

  it("album in / not_in", () => {
    expect(where([{ field: "album", op: RuleOp.in_album, value: ["a1"] }])).toEqual({
      AND: [{ albums: { some: { albumId: { in: ["a1"] } } } }],
    });
    expect(where([{ field: "album", op: RuleOp.not_in_album, value: ["a1"] }])).toEqual({
      AND: [{ albums: { none: { albumId: { in: ["a1"] } } } }],
    });
  });

  it("filename contains", () => {
    expect(where([{ field: "filename", op: RuleOp.contains, value: "beach" }])).toEqual({
      AND: [{ path: { contains: "beach", mode: "insensitive" } }],
    });
  });

  it("arbitrary exif key eq → JSON path equals", () => {
    expect(where([{ field: "exif.LightSource", op: RuleOp.eq, value: "Daylight" }])).toEqual({
      AND: [{ exif: { path: ["LightSource"], equals: "Daylight" } }],
    });
  });

  it("arbitrary exif key contains → string_contains", () => {
    expect(where([{ field: "exif.LensInfo", op: RuleOp.contains, value: "50" }])).toEqual({
      AND: [{ exif: { path: ["LensInfo"], string_contains: "50" } }],
    });
  });

  it("takenAt last_30_days → column gte cutoff", () => {
    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    expect(where([{ field: "takenAt", op: RuleOp.last_30_days }])).toEqual({
      AND: [{ takenAt: { gte: cutoff } }],
    });
  });

  it("match any → OR", () => {
    expect(
      where(
        [
          { field: "iso", op: RuleOp.gte, value: 800 },
          { field: "camera", op: RuleOp.eq, value: "iPhone" },
        ],
        MatchType.any,
      ),
    ).toEqual({
      OR: [{ iso: { gte: 800 } }, { cameraModel: { equals: "iPhone" } }],
    });
  });

  it("unsupported op for field throws", () => {
    expect(() => where([{ field: "album", op: RuleOp.gt, value: 1 }])).toThrow("unsupported rule");
  });

  it("in_list on a string column → { in: [...] }", () => {
    expect(where([{ field: "camera", op: RuleOp.in_list, value: ["Sony", "Nikon"] }])).toEqual({
      AND: [{ cameraModel: { in: ["Sony", "Nikon"] } }],
    });
  });

  it("not_in_list on a string column → { notIn: [...] }", () => {
    expect(where([{ field: "lens", op: RuleOp.not_in_list, value: ["FE 50mm"] }])).toEqual({
      AND: [{ lensModel: { notIn: ["FE 50mm"] } }],
    });
  });

  it("column ne → not", () => {
    expect(where([{ field: "camera", op: RuleOp.ne, value: "Apple" }])).toEqual({
      AND: [{ cameraModel: { not: "Apple" } }],
    });
  });

  it("column not_exists → equals null", () => {
    expect(where([{ field: "lens", op: RuleOp.not_exists }])).toEqual({
      AND: [{ lensModel: { equals: null } }],
    });
  });

  it("json exists → not AnyNull", () => {
    expect(where([{ field: "exif.LightSource", op: RuleOp.exists }])).toEqual({
      AND: [{ exif: { path: ["LightSource"], not: Prisma.AnyNull } }],
    });
  });

  it("json not_exists → equals AnyNull", () => {
    expect(where([{ field: "exif.LightSource", op: RuleOp.not_exists }])).toEqual({
      AND: [{ exif: { path: ["LightSource"], equals: Prisma.AnyNull } }],
    });
  });

  it("orientation gte/lt (portrait/landscape facet) → JSON path range", () => {
    expect(where([{ field: "orientation", op: RuleOp.gte, value: 5 }])).toEqual({
      AND: [{ exif: { path: ["orientation"], gte: 5 } }],
    });
    expect(where([{ field: "orientation", op: RuleOp.lt, value: 5 }])).toEqual({
      AND: [{ exif: { path: ["orientation"], lt: 5 } }],
    });
  });
});
