import { describe, expect, it } from "vitest";
import { computeSelection } from "./grid-selection.js";

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
