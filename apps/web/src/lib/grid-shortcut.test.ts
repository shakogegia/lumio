import { describe, it, expect } from "vitest";
import { resolveGridShortcut, type GridShortcutInput } from "./grid-shortcut";
import { LightboxTab } from "./lightbox-tab";

/** A neutral, unguarded context with a single selected photo. */
function base(overrides: Partial<GridShortcutInput> = {}): GridShortcutInput {
  return {
    key: "f",
    hasModifier: false,
    repeat: false,
    selectionSize: 1,
    lightboxOpen: false,
    inEditable: false,
    overlayOpen: false,
    ...overrides,
  };
}

describe("resolveGridShortcut", () => {
  it("f favourites any non-empty selection", () => {
    expect(resolveGridShortcut(base({ key: "f", selectionSize: 1 }))).toEqual({ kind: "favorite" });
    expect(resolveGridShortcut(base({ key: "f", selectionSize: 5 }))).toEqual({ kind: "favorite" });
  });

  it("f does nothing with an empty selection", () => {
    expect(resolveGridShortcut(base({ key: "f", selectionSize: 0 }))).toBeNull();
  });

  it("f is case-insensitive (Caps Lock) but ignores Shift+F", () => {
    expect(resolveGridShortcut(base({ key: "F", hasModifier: false }))).toEqual({ kind: "favorite" });
    expect(resolveGridShortcut(base({ key: "F", hasModifier: true }))).toBeNull();
  });

  it("Enter opens the Info tab only when exactly one is selected", () => {
    expect(resolveGridShortcut(base({ key: "Enter", selectionSize: 1 }))).toEqual({
      kind: "open",
      tab: LightboxTab.Info,
    });
    expect(resolveGridShortcut(base({ key: "Enter", selectionSize: 0 }))).toBeNull();
    expect(resolveGridShortcut(base({ key: "Enter", selectionSize: 2 }))).toBeNull();
  });

  it("e opens the Edit tab only when exactly one is selected", () => {
    expect(resolveGridShortcut(base({ key: "e", selectionSize: 1 }))).toEqual({
      kind: "open",
      tab: LightboxTab.Edit,
    });
    expect(resolveGridShortcut(base({ key: "e", selectionSize: 3 }))).toBeNull();
  });

  it("e is case-insensitive (Caps Lock) but ignores Shift+E", () => {
    expect(resolveGridShortcut(base({ key: "E", hasModifier: false }))).toEqual({
      kind: "open",
      tab: LightboxTab.Edit,
    });
    expect(resolveGridShortcut(base({ key: "E", hasModifier: true }))).toBeNull();
  });

  it("is suppressed by every guard", () => {
    expect(resolveGridShortcut(base({ lightboxOpen: true }))).toBeNull();
    expect(resolveGridShortcut(base({ hasModifier: true }))).toBeNull();
    expect(resolveGridShortcut(base({ repeat: true }))).toBeNull();
    expect(resolveGridShortcut(base({ inEditable: true }))).toBeNull();
    expect(resolveGridShortcut(base({ overlayOpen: true }))).toBeNull();
  });

  it("ignores unrelated keys", () => {
    expect(resolveGridShortcut(base({ key: "x" }))).toBeNull();
  });
});
