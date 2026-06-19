import { describe, expect, it } from "vitest";
import { parseGridView } from "./use-grid-view";

describe("parseGridView", () => {
  it("returns a valid new-key value as-is", () => {
    expect(parseGridView("card", null)).toBe("card");
    expect(parseGridView("fill", null)).toBe("fill");
    expect(parseGridView("fit", null)).toBe("fit");
  });

  it("migrates the old thumbnail-fit key", () => {
    expect(parseGridView(null, "cover")).toBe("fill");
    expect(parseGridView(null, "contain")).toBe("fit");
  });

  it("prefers a valid new value over the old key", () => {
    expect(parseGridView("fit", "cover")).toBe("fit");
  });

  it("falls back to the old key when the new value is invalid", () => {
    expect(parseGridView("garbage", "contain")).toBe("fit");
  });

  it("defaults to fill when nothing is stored or values are unknown", () => {
    expect(parseGridView(null, null)).toBe("fill");
    expect(parseGridView("nope", "nope")).toBe("fill");
  });
});
