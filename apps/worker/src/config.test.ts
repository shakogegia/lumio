import { describe, expect, it } from "vitest";
import { resolveConcurrency } from "./config.js";

describe("resolveConcurrency", () => {
  it("defaults to half the cores so a bulk import leaves CPU headroom", () => {
    expect(resolveConcurrency(undefined, 12)).toBe(6);
    expect(resolveConcurrency(undefined, 4)).toBe(2);
  });

  it("never goes below 1 (single-core box)", () => {
    expect(resolveConcurrency(undefined, 1)).toBe(1);
  });

  it("honours an explicit positive override", () => {
    expect(resolveConcurrency("8", 12)).toBe(8);
    expect(resolveConcurrency("1", 4)).toBe(1);
  });

  it("ignores empty / zero / negative / non-numeric values and falls back to the default", () => {
    expect(resolveConcurrency("", 12)).toBe(6);
    expect(resolveConcurrency("0", 12)).toBe(6);
    expect(resolveConcurrency("-5", 12)).toBe(6);
    expect(resolveConcurrency("abc", 12)).toBe(6);
  });

  it("floors fractional overrides", () => {
    expect(resolveConcurrency("3.9", 12)).toBe(3);
  });
});
