import { describe, expect, it } from "vitest";
import { slugify, updateCatalogSchema } from "./catalogs.js";

describe("slugify", () => {
  it("lowercases and dashes spaces", () => { expect(slugify("My Family Photos")).toBe("my-family-photos"); });
  it("strips punctuation and collapses separators", () => { expect(slugify("2024 — Trip!!")).toBe("2024-trip"); });
  it("trims leading/trailing dashes", () => { expect(slugify("  --Hello--  ")).toBe("hello"); });
  it("falls back to 'catalog' for empty/symbol-only input", () => { expect(slugify("   ")).toBe("catalog"); expect(slugify("***")).toBe("catalog"); });
});

describe("updateCatalogSchema", () => {
  it("accepts a reorder body with afterId as string", () => {
    const result = updateCatalogSchema.parse({ afterId: "other-id" });
    expect(result).toEqual({ afterId: "other-id" });
  });
  it("accepts a reorder body with afterId as null (move to top)", () => {
    const result = updateCatalogSchema.parse({ afterId: null });
    expect(result).toEqual({ afterId: null });
  });
  it("accepts a rename body with a non-empty name", () => {
    const result = updateCatalogSchema.parse({ name: "My Catalog" });
    expect(result).toEqual({ name: "My Catalog" });
  });
  it("rejects a rename body with an empty name", () => {
    expect(() => updateCatalogSchema.parse({ name: "" })).toThrow();
  });
  it("rejects an empty object (neither afterId nor name)", () => {
    expect(() => updateCatalogSchema.parse({})).toThrow();
  });
});
