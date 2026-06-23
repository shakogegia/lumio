import { describe, expect, it } from "vitest";
import { parseGridSort } from "./use-grid-sort";

describe("parseGridSort", () => {
  it("defaults to imported-desc for missing/empty input", () => {
    expect(parseGridSort(null)).toBe("imported-desc");
    expect(parseGridSort("")).toBe("imported-desc");
  });

  it("defaults to imported-desc for an unknown value", () => {
    expect(parseGridSort("garbage")).toBe("imported-desc");
  });

  it("returns each known sort as-is", () => {
    expect(parseGridSort("taken-asc")).toBe("taken-asc");
    expect(parseGridSort("imported-desc")).toBe("imported-desc");
    expect(parseGridSort("imported-asc")).toBe("imported-asc");
  });
});
