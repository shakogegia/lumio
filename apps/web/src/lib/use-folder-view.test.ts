import { describe, expect, it } from "vitest";
import { parseFolderView } from "./use-folder-view.js";

describe("parseFolderView", () => {
  it("returns list when explicitly stored", () => {
    expect(parseFolderView("list")).toBe("list");
  });
  it("defaults to grid for missing or unknown values", () => {
    expect(parseFolderView(null)).toBe("grid");
    expect(parseFolderView("")).toBe("grid");
    expect(parseFolderView("weird")).toBe("grid");
    expect(parseFolderView("grid")).toBe("grid");
  });
});
