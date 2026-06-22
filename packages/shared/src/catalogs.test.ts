import { describe, expect, it } from "vitest";
import { slugify } from "./catalogs.js";

describe("slugify", () => {
  it("lowercases and dashes spaces", () => { expect(slugify("My Family Photos")).toBe("my-family-photos"); });
  it("strips punctuation and collapses separators", () => { expect(slugify("2024 — Trip!!")).toBe("2024-trip"); });
  it("trims leading/trailing dashes", () => { expect(slugify("  --Hello--  ")).toBe("hello"); });
  it("falls back to 'catalog' for empty/symbol-only input", () => { expect(slugify("   ")).toBe("catalog"); expect(slugify("***")).toBe("catalog"); });
});
