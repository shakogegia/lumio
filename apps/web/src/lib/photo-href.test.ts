import { describe, expect, it } from "vitest";
import { photoHref } from "./photo-href.js";

describe("photoHref", () => {
  it("returns a catalog-scoped path with no album context", () => {
    expect(photoHref("fam", "abc")).toBe("/c/fam/photo/abc");
    expect(photoHref("fam", "abc", null)).toBe("/c/fam/photo/abc");
  });

  it("appends the album id as a query param when present", () => {
    expect(photoHref("fam", "abc", "alb1")).toBe("/c/fam/photo/abc?album=alb1");
  });
});

describe("photoHref sort", () => {
  it("omits the default sort", () => {
    expect(photoHref("fam", "abc", null, "imported-desc")).toBe("/c/fam/photo/abc");
  });

  it("appends a non-default sort", () => {
    expect(photoHref("fam", "abc", null, "imported-asc")).toBe(
      "/c/fam/photo/abc?sort=imported-asc",
    );
  });

  it("combines album and a non-default sort", () => {
    expect(photoHref("fam", "abc", "alb1", "taken-asc")).toBe(
      "/c/fam/photo/abc?album=alb1&sort=taken-asc",
    );
  });
});
