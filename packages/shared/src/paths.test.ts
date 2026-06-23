import { describe, expect, it } from "vitest";
import { parentDir } from "./paths.js";

describe("parentDir", () => {
  it("returns the directory portion", () => {
    expect(parentDir("2024/trip/a.jpg")).toBe("2024/trip");
    expect(parentDir("2024/a.jpg")).toBe("2024");
  });
  it("returns '' for a root-level file", () => {
    expect(parentDir("a.jpg")).toBe("");
    expect(parentDir("")).toBe("");
  });
});
