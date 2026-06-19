import { describe, expect, it } from "vitest";
import { photoHref } from "./photo-href.js";

describe("photoHref", () => {
  it("returns a plain path with no album context", () => {
    expect(photoHref("abc")).toBe("/photo/abc");
    expect(photoHref("abc", null)).toBe("/photo/abc");
  });

  it("appends the album id as a query param when present", () => {
    expect(photoHref("abc", "alb1")).toBe("/photo/abc?album=alb1");
  });
});

describe("photoHref sort", () => {
  it("omits the default sort", () => {
    expect(photoHref("abc", null, "taken-desc")).toBe("/photo/abc");
  });

  it("appends a non-default sort", () => {
    expect(photoHref("abc", null, "imported-asc")).toBe("/photo/abc?sort=imported-asc");
  });

  it("combines album and a non-default sort", () => {
    expect(photoHref("abc", "alb1", "taken-asc")).toBe("/photo/abc?album=alb1&sort=taken-asc");
  });
});
