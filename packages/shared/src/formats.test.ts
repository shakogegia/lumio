import { describe, expect, it } from "vitest";
import { fileExtension, isSupportedImage } from "./formats.js";

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

describe("fileExtension", () => {
  it("returns the last extension, lowercased, without the dot", () => {
    expect(fileExtension("a.JPG")).toBe("jpg");
    expect(fileExtension("dir/sub/b.heic")).toBe("heic");
    expect(fileExtension("IMG_001.CR2")).toBe("cr2");
    expect(fileExtension("archive.tar.gz")).toBe("gz");
  });
  it("returns '' when there is no usable extension", () => {
    expect(fileExtension("README")).toBe("");
    expect(fileExtension(".gitignore")).toBe(""); // dotfile, no name
    expect(fileExtension("photo.")).toBe(""); // trailing dot
    expect(fileExtension("dir.with.dots/name")).toBe(""); // dot only in a parent dir
  });
});
