import { describe, expect, it } from "vitest";
import { formatBadge, isPreviewable } from "./upload-preview";

describe("isPreviewable", () => {
  it("accepts browser-decodable formats, case-insensitively", () => {
    expect(isPreviewable("photo.jpg")).toBe(true);
    expect(isPreviewable("PHOTO.JPEG")).toBe(true);
    expect(isPreviewable("a.png")).toBe(true);
    expect(isPreviewable("a.WebP")).toBe(true);
  });
  it("rejects non-browser formats and extensionless names", () => {
    expect(isPreviewable("a.heic")).toBe(false);
    expect(isPreviewable("a.heif")).toBe(false);
    expect(isPreviewable("scan.jxl")).toBe(false);
    expect(isPreviewable("README")).toBe(false);
  });
});

describe("formatBadge", () => {
  it("returns the uppercased extension without the dot", () => {
    expect(formatBadge("a.heic")).toBe("HEIC");
    expect(formatBadge("a.JXL")).toBe("JXL");
    expect(formatBadge("a.heif")).toBe("HEIF");
  });
  it("falls back to FILE when there is no extension", () => {
    expect(formatBadge("README")).toBe("FILE");
  });
});
