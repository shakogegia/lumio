import { describe, expect, it } from "vitest";
import { RuleOp } from "./enums.js";
import { formatRuleLabel, parseFilterTokens, ruleToToken } from "./filter-tokens.js";
import type { FilterRule } from "./filters.js";

describe("parseFilterTokens", () => {
  it("leaves plain words as free text, no rules", () => {
    expect(parseFilterTokens("sunset beach")).toEqual({ rules: [], text: "sunset beach" });
  });

  it("parses a numeric comparison on a promoted field", () => {
    expect(parseFilterTokens("iso:>800")).toEqual({
      rules: [{ field: "iso", op: RuleOp.gt, value: 800 }],
      text: "",
    });
  });

  it("parses >= <= < and = ", () => {
    expect(parseFilterTokens("iso:>=800").rules[0]).toEqual({ field: "iso", op: RuleOp.gte, value: 800 });
    expect(parseFilterTokens("aperture:<=2.8").rules[0]).toEqual({ field: "aperture", op: RuleOp.lte, value: 2.8 });
    expect(parseFilterTokens("aperture:<2.8").rules[0]).toEqual({ field: "aperture", op: RuleOp.lt, value: 2.8 });
    expect(parseFilterTokens("iso:=100").rules[0]).toEqual({ field: "iso", op: RuleOp.eq, value: 100 });
  });

  it("parses a between range", () => {
    expect(parseFilterTokens("iso:200..1600").rules[0]).toEqual({
      field: "iso", op: RuleOp.between, value: [200, 1600],
    });
  });

  it("bare value on a string field → contains; alias resolves to canonical key", () => {
    expect(parseFilterTokens("camera:Sony").rules[0]).toEqual({
      field: "cameraModel", op: RuleOp.contains, value: "Sony",
    });
  });

  it("quoted value preserves spaces", () => {
    expect(parseFilterTokens('camera:"Sony A7 IV" beach')).toEqual({
      rules: [{ field: "cameraModel", op: RuleOp.contains, value: "Sony A7 IV" }],
      text: "beach",
    });
  });

  it("exists / not_exists", () => {
    expect(parseFilterTokens("lens:?").rules[0]).toEqual({ field: "lensModel", op: RuleOp.exists });
    expect(parseFilterTokens("lens:!?").rules[0]).toEqual({ field: "lensModel", op: RuleOp.not_exists });
  });

  it("unknown key falls through to a generic exif.<Key> rule", () => {
    expect(parseFilterTokens("LightSource:Daylight").rules[0]).toEqual({
      field: "exif.LightSource", op: RuleOp.contains, value: "Daylight",
    });
  });

  it("numeric comparison on a generic exif key coerces to a number", () => {
    expect(parseFilterTokens("exif.Flash:>5").rules[0]).toEqual({
      field: "exif.Flash", op: RuleOp.gt, value: 5,
    });
  });

  it("album tokens are NOT parsed (handled by @album chips) — kept as free text", () => {
    expect(parseFilterTokens("album:Trip")).toEqual({ rules: [], text: "album:Trip" });
  });

  it("an invalid op for the field is left as free text", () => {
    expect(parseFilterTokens("hasGps:>3")).toEqual({ rules: [], text: "hasGps:>3" });
  });

  it("non-numeric value on a numeric field is left as free text", () => {
    expect(parseFilterTokens("iso:abc")).toEqual({ rules: [], text: "iso:abc" });
  });

  it("mixes rules and free text, preserving leftover order", () => {
    const out = parseFilterTokens("beach iso:>800 sunset");
    expect(out.rules).toEqual([{ field: "iso", op: RuleOp.gt, value: 800 }]);
    expect(out.text).toBe("beach sunset");
  });

  it("rejects hex / scientific-notation numbers (kept as free text)", () => {
    expect(parseFilterTokens("iso:0x1F")).toEqual({ rules: [], text: "iso:0x1F" });
    expect(parseFilterTokens("iso:1e3")).toEqual({ rules: [], text: "iso:1e3" });
  });
  it("rejects a malformed triple-dot range (kept as free text)", () => {
    expect(parseFilterTokens("iso:100..200..300")).toEqual({ rules: [], text: "iso:100..200..300" });
  });
  it("a bare date value is free text (takenAt has no eq op; use >= or a range)", () => {
    expect(parseFilterTokens("date:2024-01-01")).toEqual({ rules: [], text: "date:2024-01-01" });
  });

  it("coerces a date comparison value to an ISO string", () => {
    expect(parseFilterTokens("date:>=2024-01-01").rules[0]).toEqual({
      field: "takenAt", op: RuleOp.gte, value: "2024-01-01T00:00:00.000Z",
    });
  });

  it("coerces a date between range to ISO strings", () => {
    expect(parseFilterTokens("date:2024-01-01..2024-12-31").rules[0]).toEqual({
      field: "takenAt", op: RuleOp.between, value: ["2024-01-01T00:00:00.000Z", "2024-12-31T00:00:00.000Z"],
    });
  });

  it("rejects an unparseable date value (kept as free text)", () => {
    expect(parseFilterTokens("date:>banana")).toEqual({ rules: [], text: "date:>banana" });
  });
});

describe("ruleToToken", () => {
  it("serializes each op back to token form", () => {
    expect(ruleToToken({ field: "iso", op: RuleOp.gt, value: 800 })).toBe("iso:>800");
    expect(ruleToToken({ field: "iso", op: RuleOp.gte, value: 800 })).toBe("iso:>=800");
    expect(ruleToToken({ field: "aperture", op: RuleOp.lte, value: 2.8 })).toBe("aperture:<=2.8");
    expect(ruleToToken({ field: "iso", op: RuleOp.eq, value: 100 })).toBe("iso:=100");
    expect(ruleToToken({ field: "iso", op: RuleOp.between, value: [200, 1600] })).toBe("iso:200..1600");
    expect(ruleToToken({ field: "lensModel", op: RuleOp.exists })).toBe("lensModel:?");
    expect(ruleToToken({ field: "lensModel", op: RuleOp.not_exists })).toBe("lensModel:!?");
    expect(ruleToToken({ field: "cameraModel", op: RuleOp.contains, value: "Sony" })).toBe("cameraModel:Sony");
  });

  it("quotes values containing spaces", () => {
    expect(ruleToToken({ field: "cameraModel", op: RuleOp.contains, value: "Sony A7 IV" })).toBe(
      'cameraModel:"Sony A7 IV"',
    );
  });

  it("throws for ops without a typed-token form (guards Phase 2b/3)", () => {
    expect(() => ruleToToken({ field: "takenAt", op: RuleOp.last_30_days })).toThrow("no token form");
    expect(() => ruleToToken({ field: "iso", op: RuleOp.ne, value: 100 })).toThrow("no token form");
  });

  it("round-trips through parseFilterTokens", () => {
    const rules: FilterRule[] = [
      { field: "iso", op: RuleOp.gte, value: 800 },
      { field: "cameraModel", op: RuleOp.contains, value: "Sony A7 IV" },
      { field: "iso", op: RuleOp.between, value: [200, 1600] },
      { field: "lensModel", op: RuleOp.exists },
    ];
    for (const rule of rules) {
      expect(parseFilterTokens(ruleToToken(rule)).rules[0]).toEqual(rule);
    }
  });
});

describe("formatRuleLabel", () => {
  it("renders human chip labels via the registry", () => {
    expect(formatRuleLabel({ field: "iso", op: RuleOp.gte, value: 800 })).toBe("ISO ≥ 800");
    expect(formatRuleLabel({ field: "cameraModel", op: RuleOp.contains, value: "Sony" })).toBe(
      "Camera contains Sony",
    );
    expect(formatRuleLabel({ field: "iso", op: RuleOp.between, value: [200, 1600] })).toBe("ISO: 200–1600");
    expect(formatRuleLabel({ field: "lensModel", op: RuleOp.exists })).toBe("Lens is set");
    expect(formatRuleLabel({ field: "exif.LightSource", op: RuleOp.contains, value: "Daylight" })).toBe(
      "LightSource contains Daylight",
    );
  });

  it("labels in-list rules", () => {
    expect(formatRuleLabel({ field: "cameraModel", op: RuleOp.in_list, value: ["Sony", "Nikon"] })).toBe(
      "Camera is Sony or Nikon",
    );
    expect(formatRuleLabel({ field: "lensModel", op: RuleOp.not_in_list, value: ["FE 50mm"] })).toBe(
      "Lens is not FE 50mm",
    );
  });

  it("uses a supplied fieldLabel override for per-catalog metadata fields", () => {
    expect(
      formatRuleLabel({ field: "film-stock", op: RuleOp.contains, value: "Portra" }, "Film stock"),
    ).toBe("Film stock contains Portra");
    // without the override, an unknown key falls back to the raw key
    expect(formatRuleLabel({ field: "film-stock", op: RuleOp.contains, value: "Portra" })).toBe(
      "film-stock contains Portra",
    );
  });
});
