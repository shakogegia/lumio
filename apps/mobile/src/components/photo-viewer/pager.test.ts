import { describe, it, expect } from "vitest";
import { clampIndex, shouldLoadMore } from "./pager";

describe("clampIndex", () => {
  it("clamps into [0, count-1]", () => {
    expect(clampIndex(-2, 5)).toBe(0);
    expect(clampIndex(9, 5)).toBe(4);
    expect(clampIndex(3, 5)).toBe(3);
  });
  it("returns 0 for an empty collection", () => {
    expect(clampIndex(2, 0)).toBe(0);
  });
});

describe("shouldLoadMore", () => {
  it("is true within threshold of the end", () => {
    expect(shouldLoadMore(7, 10, 3)).toBe(true); // 7 >= 10-3
    expect(shouldLoadMore(9, 10, 3)).toBe(true);
  });
  it("is false far from the end", () => {
    expect(shouldLoadMore(2, 10, 3)).toBe(false);
  });
  it("is false for an empty collection", () => {
    expect(shouldLoadMore(0, 0, 3)).toBe(false);
  });
});
