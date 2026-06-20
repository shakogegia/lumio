import { describe, expect, it } from "vitest";
import { computeFavoriteTarget } from "./favorites.js";

describe("computeFavoriteTarget", () => {
  it("returns true (favorite all) for an empty set", () => {
    expect(computeFavoriteTarget([])).toBe(true);
  });

  it("returns true when some are not favorited", () => {
    expect(
      computeFavoriteTarget([{ isFavorite: true }, { isFavorite: false }]),
    ).toBe(true);
  });

  it("returns true when none are favorited", () => {
    expect(
      computeFavoriteTarget([{ isFavorite: false }, { isFavorite: false }]),
    ).toBe(true);
  });

  it("returns false (unfavorite all) when every one is favorited", () => {
    expect(
      computeFavoriteTarget([{ isFavorite: true }, { isFavorite: true }]),
    ).toBe(false);
  });
});
