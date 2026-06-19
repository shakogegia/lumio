import { describe, expect, it } from "vitest";
import { parseGridSize } from "./use-grid-size";

describe("parseGridSize", () => {
  it("defaults to 280 when nothing is stored", () => {
    expect(parseGridSize(null)).toBe(280);
    expect(parseGridSize("")).toBe(280);
  });

  it("defaults to 280 for non-numeric input", () => {
    expect(parseGridSize("garbage")).toBe(280);
    expect(parseGridSize("NaN")).toBe(280);
  });

  it("returns valid on-step values as-is", () => {
    expect(parseGridSize("160")).toBe(160);
    expect(parseGridSize("280")).toBe(280);
    expect(parseGridSize("400")).toBe(400);
  });

  it("clamps below the minimum and above the maximum", () => {
    expect(parseGridSize("80")).toBe(160);
    expect(parseGridSize("999")).toBe(400);
  });

  it("snaps off-step values to the nearest step", () => {
    expect(parseGridSize("181")).toBe(200); // 181 -> nearest of 160/200 is 200
    expect(parseGridSize("175")).toBe(160); // 175 -> nearest of 160/200 is 160
  });
});
