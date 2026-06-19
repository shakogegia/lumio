import { describe, expect, it } from "vitest";
import { rowCount } from "./grid-layout.js";

describe("rowCount", () => {
  it("ceils items / columns", () => {
    expect(rowCount(10, 4)).toBe(3);
    expect(rowCount(12, 6)).toBe(2);
  });
  it("is 0 for empty or non-positive columns", () => {
    expect(rowCount(0, 4)).toBe(0);
    expect(rowCount(10, 0)).toBe(0);
  });
});
