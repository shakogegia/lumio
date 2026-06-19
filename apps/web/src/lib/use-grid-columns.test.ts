import { describe, expect, it } from "vitest";
import { parseGridColumns } from "./use-grid-columns";

describe("parseGridColumns", () => {
  it("defaults to 5 when nothing is stored", () => {
    expect(parseGridColumns(null)).toBe(5);
    expect(parseGridColumns("")).toBe(5);
  });

  it("defaults to 5 for non-numeric input", () => {
    expect(parseGridColumns("garbage")).toBe(5);
    expect(parseGridColumns("NaN")).toBe(5);
  });

  it("returns valid in-range values as-is", () => {
    expect(parseGridColumns("2")).toBe(2);
    expect(parseGridColumns("5")).toBe(5);
    expect(parseGridColumns("12")).toBe(12);
  });

  it("clamps below the minimum and above the maximum", () => {
    expect(parseGridColumns("1")).toBe(2);
    expect(parseGridColumns("99")).toBe(12);
  });

  it("rounds fractional values to the nearest integer", () => {
    expect(parseGridColumns("4.4")).toBe(4);
    expect(parseGridColumns("4.6")).toBe(5);
  });
});
