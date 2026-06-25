import { MatchType, RuleOp } from "@lumio/shared";
import { describe, expect, it } from "vitest";
import { buildFilters, paramsFor, scopeQuery, serialize } from "./filters.js";

describe("buildFilters", () => {
  it("dedupes albums and trims free text", () => {
    expect(buildFilters(["a1", "a1", "a2"], "  beach  ")).toEqual({
      albums: ["a1", "a2"],
      q: "beach",
      rules: [],
      match: MatchType.all,
    });
  });

  it("trims and normalizes the non-breaking spaces chips insert", () => {
    expect(buildFilters([], " a b ")).toEqual({ albums: [], q: "a b", rules: [], match: MatchType.all });
  });

  it("buildFilters parses EXIF tokens out of the text into rules, leaving free text in q", () => {
    expect(buildFilters([], "iso:>800 beach")).toEqual({
      albums: [],
      q: "beach",
      rules: [{ field: "iso", op: RuleOp.gt, value: 800 }],
      match: MatchType.all,
    });
  });

  it("buildFilters defaults match to all", () => {
    expect(buildFilters([], "iso:>800").match).toBe(MatchType.all);
  });
});

describe("paramsFor", () => {
  it("appends a repeated album param and sets q only when present", () => {
    const p = paramsFor({ albums: ["a1", "a2"], q: "beach", rules: [], match: MatchType.all });
    expect(p.getAll("album")).toEqual(["a1", "a2"]);
    expect(p.get("q")).toBe("beach");
  });

  it("omits q when empty", () => {
    expect(paramsFor({ albums: [], q: "", rules: [], match: MatchType.all }).has("q")).toBe(false);
  });

  it("paramsFor appends a filter=<json> param when rules are present", () => {
    const params = paramsFor({ albums: ["a1"], q: "beach", rules: [{ field: "iso", op: RuleOp.gt, value: 800 }], match: MatchType.all });
    expect(params.getAll("album")).toEqual(["a1"]);
    expect(params.get("q")).toBe("beach");
    expect(JSON.parse(params.get("filter")!)).toEqual({
      match: "all",
      rules: [{ field: "iso", op: RuleOp.gt, value: 800 }],
    });
  });

  it("paramsFor omits filter when there are no rules", () => {
    expect(paramsFor({ albums: [], q: "beach", rules: [], match: MatchType.all }).get("filter")).toBeNull();
  });

  it("paramsFor emits the chosen filter match", () => {
    const p = paramsFor({ albums: [], q: "", rules: [{ field: "iso", op: RuleOp.gt, value: 800 }], match: MatchType.any });
    expect(JSON.parse(p.get("filter")!)).toEqual({ match: "any", rules: [{ field: "iso", op: RuleOp.gt, value: 800 }] });
  });
});

describe("serialize", () => {
  it("is order-independent across albums", () => {
    expect(serialize({ albums: ["a", "b"], q: "x", rules: [], match: MatchType.all })).toBe(
      serialize({ albums: ["b", "a"], q: "x", rules: [], match: MatchType.all }),
    );
  });

  it("serialize includes the rules so the grid remounts when they change", () => {
    const a = serialize({ albums: [], q: "", rules: [{ field: "iso", op: RuleOp.gt, value: 800 }], match: MatchType.all });
    const b = serialize({ albums: [], q: "", rules: [{ field: "iso", op: RuleOp.gt, value: 400 }], match: MatchType.all });
    expect(a).not.toBe(b);
  });

  it("serialize distinguishes match", () => {
    const base = { albums: [], q: "", rules: [{ field: "iso", op: RuleOp.gt, value: 800 }] };
    expect(serialize({ ...base, match: MatchType.all })).not.toBe(serialize({ ...base, match: MatchType.any }));
  });
});

describe("paramsFor sort", () => {
  it("omits the default sort", () => {
    expect(paramsFor({ albums: [], q: "", rules: [], match: MatchType.all }, "imported-desc").has("sort")).toBe(false);
  });

  it("sets a non-default sort", () => {
    expect(paramsFor({ albums: [], q: "", rules: [], match: MatchType.all }, "imported-asc").get("sort")).toBe("imported-asc");
  });
});

describe("scopeQuery sort", () => {
  it("marks the search scope and appends a non-default sort", () => {
    const q = scopeQuery({ albums: ["a1"], q: "beach", rules: [], match: MatchType.all }, "taken-desc");
    const params = new URLSearchParams(q);
    expect(params.get("s")).toBe("1");
    expect(params.getAll("album")).toEqual(["a1"]);
    expect(params.get("q")).toBe("beach");
    expect(params.get("sort")).toBe("taken-desc");
  });

  it("omits a default sort", () => {
    expect(new URLSearchParams(scopeQuery({ albums: [], q: "", rules: [], match: MatchType.all }, "imported-desc")).has("sort")).toBe(
      false,
    );
  });

  it("scopeQuery carries the filter param for detail-scope URLs", () => {
    const qs = scopeQuery({ albums: [], q: "", rules: [{ field: "iso", op: RuleOp.gt, value: 800 }], match: MatchType.all });
    expect(qs).toContain("filter=");
    expect(qs).toContain("s=1");
  });
});
