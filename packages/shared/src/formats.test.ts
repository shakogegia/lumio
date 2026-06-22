import { describe, expect, it } from "vitest";
import { isSupportedImage } from "./formats.js";

describe("isSupportedImage", () => {
  it("accepts supported extensions case-insensitively", () => {
    expect(isSupportedImage("a.JPG")).toBe(true);
    expect(isSupportedImage("dir/sub/b.heic")).toBe(true);
    expect(isSupportedImage("c.jxl")).toBe(true);
  });
  it("rejects non-image and extensionless names", () => {
    expect(isSupportedImage("notes.txt")).toBe(false);
    expect(isSupportedImage("README")).toBe(false);
    expect(isSupportedImage("archive.zip")).toBe(false);
  });
});
