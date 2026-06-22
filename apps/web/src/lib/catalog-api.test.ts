import { describe, it, expect } from "vitest";
import { catalogApiUrl, catalogPath } from "@/lib/catalog-api";

describe("catalogApiUrl", () => {
  it("joins slug and path with leading slash", () => {
    expect(catalogApiUrl("fam", "/photos")).toBe("/api/c/fam/photos");
  });

  it("adds leading slash when path has no leading slash", () => {
    expect(catalogApiUrl("fam", "photos")).toBe("/api/c/fam/photos");
  });

  it("preserves leading slash when path already has one", () => {
    expect(catalogApiUrl("fam", "/albums/123")).toBe("/api/c/fam/albums/123");
  });

  it("encodes slug with spaces", () => {
    expect(catalogApiUrl("my cat", "/photos")).toBe("/api/c/my%20cat/photos");
  });

  it("encodes slug with special characters", () => {
    expect(catalogApiUrl("a&b", "/photos")).toBe("/api/c/a%26b/photos");
  });

  it("preserves query string", () => {
    expect(catalogApiUrl("f", "/search?q=x")).toBe("/api/c/f/search?q=x");
  });

  it("preserves versioned query string", () => {
    expect(catalogApiUrl("fam", "/photos/123/thumbnail?v=1234567890")).toBe(
      "/api/c/fam/photos/123/thumbnail?v=1234567890",
    );
  });
});

describe("catalogPath", () => {
  it("joins slug and path with leading slash", () => {
    expect(catalogPath("fam", "/photos")).toBe("/c/fam/photos");
  });

  it("adds leading slash when path has no leading slash", () => {
    expect(catalogPath("fam", "photos")).toBe("/c/fam/photos");
  });

  it("preserves leading slash when path already has one", () => {
    expect(catalogPath("fam", "/albums/123")).toBe("/c/fam/albums/123");
  });

  it("encodes slug with spaces", () => {
    expect(catalogPath("my cat", "/photos")).toBe("/c/my%20cat/photos");
  });

  it("encodes slug with special characters", () => {
    expect(catalogPath("a&b", "/photos")).toBe("/c/a%26b/photos");
  });

  it("preserves query string", () => {
    expect(catalogPath("f", "/search?q=x")).toBe("/c/f/search?q=x");
  });

  it("preserves a path with album id and query string", () => {
    expect(catalogPath("fam", "/upload?albumId=123")).toBe("/c/fam/upload?albumId=123");
  });
});
