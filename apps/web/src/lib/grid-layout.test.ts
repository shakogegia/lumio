import { describe, expect, it } from "vitest";
import { computeColumns, rowCount, MIN_TILE, GRID_GAP } from "./grid-layout.js";

describe("computeColumns", () => {
  it("returns 1 for non-positive width", () => {
    expect(computeColumns(0)).toBe(1);
    expect(computeColumns(-50)).toBe(1);
  });
  it("computes columns from width using MIN_TILE + GRID_GAP", () => {
    expect(computeColumns(MIN_TILE)).toBe(1);
    expect(computeColumns(1280)).toBe(4);
  });
  it("uses a custom minTile to widen tiles (fewer columns)", () => {
    // 1200px wide, GRID_GAP (4). Default minTile 280 -> 4 cols; 320 -> 3 cols; 160 -> 7 cols.
    // formula: floor((width + gap) / (minTile + gap))
    expect(computeColumns(1200, 280, GRID_GAP)).toBe(4);
    expect(computeColumns(1200, 320, GRID_GAP)).toBe(3);
    expect(computeColumns(1200, 160, GRID_GAP)).toBe(7);
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
