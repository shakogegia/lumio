import { describe, it, expect } from "vitest";
import {
  shouldOpenSelectedItem,
  type FolderBrowserShortcutInput,
} from "./folder-browser-shortcut";

/** A neutral, unguarded Enter press with a single selected item. */
function base(
  overrides: Partial<FolderBrowserShortcutInput> = {},
): FolderBrowserShortcutInput {
  return {
    key: "Enter",
    hasModifier: false,
    repeat: false,
    selectionSize: 1,
    inEditable: false,
    overlayOpen: false,
    ...overrides,
  };
}

describe("shouldOpenSelectedItem", () => {
  it("opens on Enter when exactly one item is selected", () => {
    expect(shouldOpenSelectedItem(base())).toBe(true);
  });

  it("does nothing with zero or multiple selected", () => {
    expect(shouldOpenSelectedItem(base({ selectionSize: 0 }))).toBe(false);
    expect(shouldOpenSelectedItem(base({ selectionSize: 2 }))).toBe(false);
  });

  it("ignores non-Enter keys", () => {
    expect(shouldOpenSelectedItem(base({ key: "e" }))).toBe(false);
    expect(shouldOpenSelectedItem(base({ key: "f" }))).toBe(false);
    expect(shouldOpenSelectedItem(base({ key: "x" }))).toBe(false);
  });

  it("is suppressed by every guard", () => {
    expect(shouldOpenSelectedItem(base({ hasModifier: true }))).toBe(false);
    expect(shouldOpenSelectedItem(base({ repeat: true }))).toBe(false);
    expect(shouldOpenSelectedItem(base({ inEditable: true }))).toBe(false);
    expect(shouldOpenSelectedItem(base({ overlayOpen: true }))).toBe(false);
  });
});
