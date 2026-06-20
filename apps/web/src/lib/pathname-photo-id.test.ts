import { describe, expect, it } from "vitest";
import { photoIdFromPathname } from "./pathname-photo-id.js";

describe("photoIdFromPathname", () => {
  it("extracts the id from a /photo/[id] path", () => {
    expect(photoIdFromPathname("/photo/abc123")).toBe("abc123");
  });
  it("ignores a trailing slash", () => {
    expect(photoIdFromPathname("/photo/abc123/")).toBe("abc123");
  });
  it("returns null for non-photo paths", () => {
    expect(photoIdFromPathname("/photos")).toBeNull();
    expect(photoIdFromPathname("/albums/x")).toBeNull();
    expect(photoIdFromPathname("/photo/")).toBeNull();
  });
});
