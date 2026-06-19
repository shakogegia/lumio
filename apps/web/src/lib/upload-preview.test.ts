import { describe, expect, it } from "vitest";
import { formatBadge } from "./upload-preview";

describe("formatBadge", () => {
  it("returns the uppercased extension without the dot", () => {
    expect(formatBadge("a.heic")).toBe("HEIC");
    expect(formatBadge("a.JXL")).toBe("JXL");
    expect(formatBadge("a.heif")).toBe("HEIF");
    expect(formatBadge("photo.jpg")).toBe("JPG");
  });
  it("falls back to FILE when there is no extension", () => {
    expect(formatBadge("README")).toBe("FILE");
  });
});
