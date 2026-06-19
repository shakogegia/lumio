import { describe, expect, it } from "vitest";
import { parseGridSort } from "./use-grid-sort";

describe("parseGridSort", () => {
  it("defaults to taken-desc for missing/empty input", () => {
    expect(parseGridSort(null)).toBe("taken-desc");
    expect(parseGridSort("")).toBe("taken-desc");
  });

  it("defaults to taken-desc for an unknown value", () => {
    expect(parseGridSort("garbage")).toBe("taken-desc");
  });

  it("returns each known sort as-is", () => {
    expect(parseGridSort("taken-asc")).toBe("taken-asc");
    expect(parseGridSort("imported-desc")).toBe("imported-desc");
    expect(parseGridSort("imported-asc")).toBe("imported-asc");
  });
});
