import { describe, expect, it } from "vitest";
import { computeColumns, rowCount, MIN_TILE, GRID_GAP } from "./grid-layout.js";

describe("computeColumns", () => {
  it("returns 1 for non-positive width", () => {
    expect(computeColumns(0)).toBe(1);
    expect(computeColumns(-50)).toBe(1);
  });
  it("computes columns from width using MIN_TILE + GRID_GAP", () => {
    expect(computeColumns(MIN_TILE)).toBe(1);
    expect(computeColumns(1280)).toBe(6);
  });
});

describe("rowCount", () => {
  it("ceils items / columns", () => {
    expect(rowCount(10, 4)).toBe(3);
    expect(rowCount(12, 6)).toBe(2);
  });
  it("is 0 for empty or non-positive columns", () => {
    expect(rowCount(0, 4)).toBe(0);
    expect(rowCount(10, 0)).toBe(0);
  });
});
