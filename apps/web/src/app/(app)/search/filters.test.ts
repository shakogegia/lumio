import { describe, expect, it } from "vitest";
import { buildFilters, paramsFor, scopeQuery, serialize } from "./filters.js";

describe("buildFilters", () => {
  it("dedupes albums and trims free text", () => {
    expect(buildFilters(["a1", "a1", "a2"], "  beach  ")).toEqual({
      albums: ["a1", "a2"],
      q: "beach",
    });
  });

  it("trims and normalizes the non-breaking spaces chips insert", () => {
    expect(buildFilters([], "\u00A0a\u00A0b\u00A0")).toEqual({ albums: [], q: "a b" });
  });
});

describe("paramsFor", () => {
  it("appends a repeated album param and sets q only when present", () => {
    const p = paramsFor({ albums: ["a1", "a2"], q: "beach" });
    expect(p.getAll("album")).toEqual(["a1", "a2"]);
    expect(p.get("q")).toBe("beach");
  });

  it("omits q when empty", () => {
    expect(paramsFor({ albums: [], q: "" }).has("q")).toBe(false);
  });
});

describe("serialize", () => {
  it("is order-independent across albums", () => {
    expect(serialize({ albums: ["a", "b"], q: "x" })).toBe(
      serialize({ albums: ["b", "a"], q: "x" }),
    );
  });
});

describe("paramsFor sort", () => {
  it("omits the default sort", () => {
    expect(paramsFor({ albums: [], q: "" }, "taken-desc").has("sort")).toBe(false);
  });

  it("sets a non-default sort", () => {
    expect(paramsFor({ albums: [], q: "" }, "imported-asc").get("sort")).toBe("imported-asc");
  });
});

describe("scopeQuery sort", () => {
  it("marks the search scope and appends a non-default sort", () => {
    const q = scopeQuery({ albums: ["a1"], q: "beach" }, "imported-desc");
    const params = new URLSearchParams(q);
    expect(params.get("s")).toBe("1");
    expect(params.getAll("album")).toEqual(["a1"]);
    expect(params.get("q")).toBe("beach");
    expect(params.get("sort")).toBe("imported-desc");
  });

  it("omits a default sort", () => {
    expect(new URLSearchParams(scopeQuery({ albums: [], q: "" }, "taken-desc")).has("sort")).toBe(
      false,
    );
  });
});
