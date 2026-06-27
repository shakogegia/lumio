import { describe, expect, it } from "vitest";
import { ValueType, MatchType, RuleOp } from "./index.js";
import { filterSetSchema, resolveField, SYSTEM_FIELD_KEYS } from "./filters.js";

describe("resolveField", () => {
  it("resolves a known field by key", () => {
    const f = resolveField("iso");
    expect(f.type).toBe(ValueType.number);
    expect(f.storage).toEqual({ kind: "column", column: "iso" });
    expect(f.ops).toContain(RuleOp.gte);
  });

  it("resolves aliases (camera → cameraModel, aperture → fNumber column)", () => {
    expect(resolveField("camera").key).toBe("cameraModel");
    expect(resolveField("aperture").storage).toEqual({ kind: "column", column: "fNumber" });
  });

  it("resolves album + filename to special storage", () => {
    expect(resolveField("album").storage).toEqual({ kind: "album" });
    expect(resolveField("filename").storage).toEqual({ kind: "filename" });
  });

  it("unknown key → generic exif JSON path (any field is searchable)", () => {
    const f = resolveField("LightSource");
    expect(f.storage).toEqual({ kind: "json", path: ["LightSource"] });
    expect(f.key).toBe("exif.LightSource");
    expect(f.ops).toContain(RuleOp.contains);
  });

  it("explicit exif.<Key> strips the prefix in the JSON path", () => {
    expect(resolveField("exif.cameraModel").storage).toEqual({ kind: "json", path: ["cameraModel"] });
  });
});

describe("filterSetSchema", () => {
  const ok = (rules: unknown) => filterSetSchema.safeParse({ match: MatchType.all, rules });

  it("accepts a valid numeric range + album rule", () => {
    expect(ok([
      { field: "iso", op: RuleOp.between, value: [200, 1600] },
      { field: "album", op: RuleOp.in_album, value: ["a1", "a2"] },
    ]).success).toBe(true);
  });

  it("accepts exists with no value", () => {
    expect(ok([{ field: "lens", op: RuleOp.exists }]).success).toBe(true);
  });

  it("rejects an operator not valid for the field", () => {
    expect(ok([{ field: "album", op: RuleOp.gt, value: 1 }]).success).toBe(false);
  });

  it("rejects between without a 2-tuple", () => {
    expect(ok([{ field: "iso", op: RuleOp.between, value: 200 }]).success).toBe(false);
  });

  it("rejects a scalar op with a missing value", () => {
    expect(ok([{ field: "iso", op: RuleOp.eq }]).success).toBe(false);
  });

  it("rejects between with non-finite numbers on a numeric field", () => {
    expect(ok([{ field: "iso", op: RuleOp.between, value: [Number.NaN, 1600] }]).success).toBe(false);
  });
  it("rejects a numeric field compared to a string", () => {
    expect(ok([{ field: "iso", op: RuleOp.gt, value: "800" }]).success).toBe(false);
  });
  it("accepts a boolean for hasGps but rejects a non-boolean", () => {
    expect(ok([{ field: "hasGps", op: RuleOp.eq, value: true }]).success).toBe(true);
    expect(ok([{ field: "hasGps", op: RuleOp.eq, value: "yes" }]).success).toBe(false);
  });
  it("stays permissive for arbitrary exif keys (numeric compare on a json field ok)", () => {
    expect(ok([{ field: "exif.Flash", op: RuleOp.gt, value: 5 }]).success).toBe(true);
  });
});

describe("in_list operator", () => {
  it("string column fields allow in_list / not_in_list", () => {
    expect(resolveField("camera").ops).toContain(RuleOp.in_list);
    expect(resolveField("lens").ops).toContain(RuleOp.not_in_list);
    expect(resolveField("cameraMake").ops).toContain(RuleOp.in_list);
  });
  it("number/json/album fields do NOT get in_list", () => {
    expect(resolveField("iso").ops).not.toContain(RuleOp.in_list);
    expect(resolveField("album").ops).not.toContain(RuleOp.in_list);
    expect(resolveField("exif.LightSource").ops).not.toContain(RuleOp.in_list);
  });
  it("filterSetSchema accepts in_list with a non-empty string[]", () => {
    const ok = filterSetSchema.safeParse({
      match: MatchType.all,
      rules: [{ field: "camera", op: RuleOp.in_list, value: ["Sony", "Nikon"] }],
    });
    expect(ok.success).toBe(true);
  });
  it("filterSetSchema rejects in_list with an empty array or non-strings", () => {
    const bad1 = filterSetSchema.safeParse({ match: MatchType.all, rules: [{ field: "camera", op: RuleOp.in_list, value: [] }] });
    const bad2 = filterSetSchema.safeParse({ match: MatchType.all, rules: [{ field: "camera", op: RuleOp.in_list, value: [1, 2] }] });
    expect(bad1.success).toBe(false);
    expect(bad2.success).toBe(false);
  });
  it("accepts in_list on an unknown (metadata) field key — ops are gated by the per-catalog registry, not the wire", () => {
    const r = filterSetSchema.safeParse({
      match: MatchType.all,
      rules: [{ field: "format", op: RuleOp.in_list, value: ["6×6", "6×7"] }],
    });
    expect(r.success).toBe(true);
  });
});

describe("extension system field", () => {
  it("resolves a column-backed extension field with in_list ops and ext/filetype aliases", () => {
    const def = resolveField("extension");
    expect(def.key).toBe("extension");
    expect(def.storage).toEqual({ kind: "column", column: "extension" });
    expect(def.ops).toContain(RuleOp.in_list);
    expect(def.ops).toContain(RuleOp.not_in_list);
    expect(resolveField("ext").key).toBe("extension");
    expect(resolveField("filetype").key).toBe("extension");
  });
  it("is in the system-field allowlist", () => {
    expect(SYSTEM_FIELD_KEYS.has("extension")).toBe(true);
  });
});
