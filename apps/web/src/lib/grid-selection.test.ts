import { describe, expect, it } from "vitest";
import { arrowSelection, computeSelection, nextGridIndex } from "./grid-selection.js";

const IDS = ["a", "b", "c", "d", "e"];

const PLAIN = { shift: false, toggle: false };
const TOGGLE = { shift: false, toggle: true };
const SHIFT = { shift: true, toggle: false };

describe("computeSelection", () => {
  it("selects only the clicked photo on a plain click", () => {
    const next = computeSelection(new Set(), IDS, 2, PLAIN, null);
    expect([...next]).toEqual(["c"]);
  });

  it("replaces the whole selection with the clicked photo on a plain click", () => {
    const next = computeSelection(new Set(["a", "b", "e"]), IDS, 2, PLAIN, null);
    expect([...next]).toEqual(["c"]);
  });

  it("keeps a single re-clicked photo selected (plain click is idempotent)", () => {
    const next = computeSelection(new Set(["c"]), IDS, 2, PLAIN, null);
    expect([...next]).toEqual(["c"]);
  });

  it("adds an unselected photo to the selection on a ⌘/Ctrl click", () => {
    const next = computeSelection(new Set(["a"]), IDS, 2, TOGGLE, null);
    expect([...next].sort()).toEqual(["a", "c"]);
  });

  it("removes a selected photo on a ⌘/Ctrl click (toggle off)", () => {
    const next = computeSelection(new Set(["a", "c"]), IDS, 2, TOGGLE, null);
    expect([...next]).toEqual(["a"]);
  });

  it("selects the inclusive range from anchor to index on shift-click", () => {
    const next = computeSelection(new Set(["a"]), IDS, 3, SHIFT, 1);
    expect([...next].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("handles a shift range that runs backwards (index before anchor)", () => {
    const next = computeSelection(new Set(), IDS, 1, SHIFT, 3);
    expect([...next].sort()).toEqual(["b", "c", "d"]);
  });

  it("keeps the existing selection when extending a range (shift is additive)", () => {
    // Plain-click "a" then ⌘-click "e", then shift-click "c" from anchor "a":
    // the range a–c is added without dropping the ⌘-selected "e".
    const next = computeSelection(new Set(["a", "e"]), IDS, 2, SHIFT, 0);
    expect([...next].sort()).toEqual(["a", "b", "c", "e"]);
  });

  it("selects only the clicked photo when shift is held but anchor is null", () => {
    const next = computeSelection(new Set(["a"]), IDS, 2, SHIFT, null);
    expect([...next]).toEqual(["c"]);
  });
});

describe("nextGridIndex", () => {
  // 5 items, 3 columns:  [0 1 2 / 3 4]
  it("lands on the first item when nothing is focused yet", () => {
    expect(nextGridIndex(null, "ArrowDown", 3, 5)).toBe(0);
    expect(nextGridIndex(null, "ArrowUp", 3, 5)).toBe(0);
  });

  it("moves one column left/right and clamps at the row/grid edges", () => {
    expect(nextGridIndex(1, "ArrowLeft", 3, 5)).toBe(0);
    expect(nextGridIndex(1, "ArrowRight", 3, 5)).toBe(2);
    expect(nextGridIndex(0, "ArrowLeft", 3, 5)).toBe(0); // already first
    expect(nextGridIndex(4, "ArrowRight", 3, 5)).toBe(4); // already last
  });

  it("moves one row up/down by the column count", () => {
    expect(nextGridIndex(3, "ArrowUp", 3, 5)).toBe(0);
    expect(nextGridIndex(0, "ArrowDown", 3, 5)).toBe(3);
  });

  it("clamps vertical moves that would leave the grid", () => {
    expect(nextGridIndex(1, "ArrowUp", 3, 5)).toBe(1); // top row, no row above
    expect(nextGridIndex(4, "ArrowDown", 3, 5)).toBe(4); // no row below (index 7 absent)
  });
});
