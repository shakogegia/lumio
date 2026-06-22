import path from "node:path";
import { describe, expect, it } from "vitest";
import { isInsideMediaRoot, originalPath } from "./paths.js";

// MEDIA_ROOT defaults to /media (process.env.MEDIA_ROOT is not set in test env)

describe("isInsideMediaRoot", () => {
  it("accepts the MEDIA_ROOT itself", () => {
    expect(isInsideMediaRoot("/media")).toBe(true);
  });

  it("accepts a subdirectory of MEDIA_ROOT", () => {
    expect(isInsideMediaRoot("/media/family")).toBe(true);
  });

  it("accepts a deeply nested path under MEDIA_ROOT", () => {
    expect(isInsideMediaRoot("/media/family/2024/vacation")).toBe(true);
  });

  it("rejects a path with traversal that resolves outside MEDIA_ROOT", () => {
    // /media/../etc resolves to /etc
    expect(isInsideMediaRoot("/media/../etc")).toBe(false);
  });

  it("rejects /etc/passwd", () => {
    expect(isInsideMediaRoot("/etc/passwd")).toBe(false);
  });

  it("rejects a path that has MEDIA_ROOT as a prefix in its name but is not inside it", () => {
    // /media-other should not be considered inside /media
    expect(isInsideMediaRoot("/media-other")).toBe(false);
  });
});

describe("originalPath", () => {
  it("returns the resolved path when relPath stays within catalog.path", () => {
    const catalog = { path: "/media/family" };
    const result = originalPath(catalog, "2024/photo.jpg");
    expect(result).toBe(path.join("/media/family", "2024/photo.jpg"));
  });

  it("throws on path traversal that escapes the catalog path", () => {
    const catalog = { path: "/media/family" };
    expect(() => originalPath(catalog, "../etc/passwd")).toThrow("Path traversal blocked");
  });

  it("throws on absolute path that escapes the catalog path", () => {
    const catalog = { path: "/media/family" };
    expect(() => originalPath(catalog, "/etc/passwd")).toThrow("Path traversal blocked");
  });

  it("allows a file directly inside catalog.path", () => {
    const catalog = { path: "/media/family" };
    expect(originalPath(catalog, "photo.jpg")).toBe("/media/family/photo.jpg");
  });
});
