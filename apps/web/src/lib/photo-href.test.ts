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
