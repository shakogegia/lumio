import { describe, expect, it } from "vitest";
import { buildFilters, paramsFor, serialize } from "./filters.js";

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
