import { describe, expect, it } from "vitest";
import { computeSelection } from "./grid-selection.js";

const IDS = ["a", "b", "c", "d", "e"];

describe("computeSelection", () => {
  it("adds an unselected photo on a plain click", () => {
    const next = computeSelection(new Set(), IDS, 2, false, null);
    expect([...next]).toEqual(["c"]);
  });

  it("removes a selected photo on a plain click (toggle off)", () => {
    const next = computeSelection(new Set(["c"]), IDS, 2, false, null);
    expect([...next]).toEqual([]);
  });

  it("selects the inclusive range from anchor to index on shift-click", () => {
    const next = computeSelection(new Set(["a"]), IDS, 3, true, 1);
    expect([...next].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("handles a shift range that runs backwards (index before anchor)", () => {
    const next = computeSelection(new Set(), IDS, 1, true, 3);
    expect([...next].sort()).toEqual(["b", "c", "d"]);
  });

  it("falls back to a single toggle when shift is held but anchor is null", () => {
    const next = computeSelection(new Set(), IDS, 2, true, null);
    expect([...next]).toEqual(["c"]);
  });
});
