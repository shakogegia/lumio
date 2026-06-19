import { describe, expect, it } from "vitest";
import {
  COLOR_LABELS,
  COLOR_LABEL_SLUGS,
  colorLabelHex,
  colorLabelSchema,
} from "./color-labels.js";

describe("COLOR_LABELS palette", () => {
  it("has 8 entries whose slugs match the schema options in order", () => {
    expect(COLOR_LABELS.map((c) => c.slug)).toEqual([...COLOR_LABEL_SLUGS]);
    expect(COLOR_LABEL_SLUGS).toEqual([
      "gray",
      "pink",
      "orange",
      "yellow",
      "green",
      "cyan",
      "blue",
      "purple",
    ]);
  });

  it("every entry has a name and a hex color", () => {
    for (const c of COLOR_LABELS) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});

describe("colorLabelHex", () => {
  it("returns the hex for a known slug", () => {
    expect(colorLabelHex("green")).toBe("#D0E3C9");
  });

  it("returns undefined for null/undefined", () => {
    expect(colorLabelHex(null)).toBeUndefined();
    expect(colorLabelHex(undefined)).toBeUndefined();
  });
});

describe("colorLabelSchema", () => {
  it("accepts a valid slug", () => {
    expect(colorLabelSchema.parse("blue")).toBe("blue");
  });

  it("rejects an unknown slug", () => {
    expect(() => colorLabelSchema.parse("magenta")).toThrow();
  });
});
