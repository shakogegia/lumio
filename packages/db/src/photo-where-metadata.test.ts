import { describe, expect, it } from "vitest";
import { MatchType, RuleOp, ValueType, type FieldDef, type SearchRegistry } from "@lumio/shared";
import { buildPhotoWhere } from "./photo-where.js";

const NOW = new Date("2026-06-26T00:00:00Z");
const custom = (key: string, fieldId: string): FieldDef =>
  ({ key, label: key, type: ValueType.string, storage: { kind: "metadata", fieldId }, ops: [] });
const standardStr = (key: string, fieldId: string, column: string): FieldDef =>
  ({ key, label: key, type: ValueType.string, storage: { kind: "standard", column, fieldId }, ops: [] });
const standardNum = (key: string, fieldId: string, column: string): FieldDef =>
  ({ key, label: key, type: ValueType.number, storage: { kind: "standard", column, fieldId }, ops: [] });
const reg = (...defs: FieldDef[]): SearchRegistry => new Map(defs.map((d) => [d.key, d]));

describe("buildPhotoWhere — custom metadata fields", () => {
  it("eq → metadataValues.some on fieldId (insensitive)", () => {
    const where = buildPhotoWhere(
      { match: MatchType.all, rules: [{ field: "film", op: RuleOp.eq, value: "Portra" }] },
      NOW, reg(custom("film", "f1")),
    );
    expect(where).toEqual({ AND: [{ metadataValues: { some: { fieldId: "f1", value: { equals: "Portra", mode: "insensitive" } } } }] });
  });
  it("contains → some.value.contains insensitive", () => {
    const where = buildPhotoWhere(
      { match: MatchType.all, rules: [{ field: "dev", op: RuleOp.contains, value: "D76" }] },
      NOW, reg(custom("dev", "f2")),
    );
    expect(where).toEqual({ AND: [{ metadataValues: { some: { fieldId: "f2", value: { contains: "D76", mode: "insensitive" } } } }] });
  });
  it("in_list → some.value.in ; not_in_list → none.value.in", () => {
    const r = reg(custom("fmt", "f3"));
    expect(buildPhotoWhere({ match: MatchType.all, rules: [{ field: "fmt", op: RuleOp.in_list, value: ["6×6", "6×7"] }] }, NOW, r))
      .toEqual({ AND: [{ metadataValues: { some: { fieldId: "f3", value: { in: ["6×6", "6×7"] } } } }] });
    expect(buildPhotoWhere({ match: MatchType.all, rules: [{ field: "fmt", op: RuleOp.not_in_list, value: ["110"] }] }, NOW, r))
      .toEqual({ AND: [{ metadataValues: { none: { fieldId: "f3", value: { in: ["110"] } } } }] });
  });
  it("exists → some.fieldId ; not_exists → none.fieldId", () => {
    const r = reg(custom("note", "f4"));
    expect(buildPhotoWhere({ match: MatchType.all, rules: [{ field: "note", op: RuleOp.exists }] }, NOW, r))
      .toEqual({ AND: [{ metadataValues: { some: { fieldId: "f4" } } }] });
    expect(buildPhotoWhere({ match: MatchType.all, rules: [{ field: "note", op: RuleOp.not_exists }] }, NOW, r))
      .toEqual({ AND: [{ metadataValues: { none: { fieldId: "f4" } } }] });
  });
});

describe("buildPhotoWhere — standard string fields (effective value)", () => {
  it("eq matches the override OR (no override AND EXIF column)", () => {
    const where = buildPhotoWhere(
      { match: MatchType.all, rules: [{ field: "camera", op: RuleOp.eq, value: "Hasselblad" }] },
      NOW, reg(standardStr("camera", "s1", "cameraModel")),
    );
    expect(where).toEqual({ AND: [{ OR: [
      { metadataValues: { some: { fieldId: "s1", value: { equals: "Hasselblad", mode: "insensitive" } } } },
      { AND: [{ metadataValues: { none: { fieldId: "s1" } } }, { cameraModel: { equals: "Hasselblad" } }] },
    ] }] });
  });
  it("exists → override exists OR column not null", () => {
    const where = buildPhotoWhere(
      { match: MatchType.all, rules: [{ field: "camera", op: RuleOp.exists }] },
      NOW, reg(standardStr("camera", "s1", "cameraModel")),
    );
    expect(where).toEqual({ AND: [{ OR: [
      { metadataValues: { some: { fieldId: "s1" } } },
      { cameraModel: { not: null } },
    ] }] });
  });
});

describe("buildPhotoWhere — standard numeric fields (typed column)", () => {
  it("between → column gte/lte", () => {
    const where = buildPhotoWhere(
      { match: MatchType.all, rules: [{ field: "iso", op: RuleOp.between, value: [200, 800] }] },
      NOW, reg(standardNum("iso", "s2", "iso")),
    );
    expect(where).toEqual({ AND: [{ iso: { gte: 200, lte: 800 } }] });
  });
});

describe("buildPhotoWhere — fallback unchanged", () => {
  it("with no registry, album/filename still resolve via the static path", () => {
    const where = buildPhotoWhere(
      { match: MatchType.all, rules: [{ field: "album", op: RuleOp.in_album, value: ["a1"] }] },
      NOW,
    );
    expect(where).toEqual({ AND: [{ albums: { some: { albumId: { in: ["a1"] } } } }] });
  });
});
