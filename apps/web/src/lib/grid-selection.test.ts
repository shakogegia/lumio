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

  it("nets to a no-op when the same tile is toggled twice (double-click invariant)", () => {
    // A double-click fires two plain clicks before the detail opens; toggling the
    // same tile twice must leave the selection exactly as it started.
    const start = new Set(["a", "c"]);
    const once = computeSelection(start, IDS, 2, false, null); // "c" off
    const twice = computeSelection(once, IDS, 2, false, null); // "c" back on
    expect([...twice].sort()).toEqual(["a", "c"]);
  });
});
