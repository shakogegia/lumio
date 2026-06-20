import { describe, expect, it } from "vitest";
import { imageElementReady } from "./use-image-loaded.js";

describe("imageElementReady", () => {
  it("is false for a null element", () => {
    expect(imageElementReady(null)).toBe(false);
  });

  it("is false while incomplete", () => {
    expect(imageElementReady({ complete: false, naturalWidth: 0 })).toBe(false);
  });

  it("is false when complete but broken (naturalWidth 0)", () => {
    expect(imageElementReady({ complete: true, naturalWidth: 0 })).toBe(false);
  });

  it("is true when complete AND decoded (the cached-image case)", () => {
    expect(imageElementReady({ complete: true, naturalWidth: 1535 })).toBe(true);
  });
});
