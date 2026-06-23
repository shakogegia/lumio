import { describe, expect, it } from "vitest";
import { isPhotoDetailPath, photoIdFromPathname } from "./pathname-photo-id.js";

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

describe("isPhotoDetailPath", () => {
  it("matches the catalog-scoped photo-detail route", () => {
    expect(isPhotoDetailPath("/c/fam/photo/abc123", "fam")).toBe(true);
  });

  // The grid route is /c/<slug>/photos — a leading substring of which (/photo)
  // must NOT be mistaken for the detail route /c/<slug>/photo/<id>.
  it("does not match the grid route", () => {
    expect(isPhotoDetailPath("/c/fam/photos", "fam")).toBe(false);
  });

  it("does not match sibling catalog routes", () => {
    expect(isPhotoDetailPath("/c/fam/albums", "fam")).toBe(false);
    expect(isPhotoDetailPath("/c/fam/search", "fam")).toBe(false);
    expect(isPhotoDetailPath("/c/fam/folders", "fam")).toBe(false);
  });

  it("is scoped to the active catalog slug", () => {
    expect(isPhotoDetailPath("/c/other/photo/abc123", "fam")).toBe(false);
  });

  // Edge: a catalog whose slug is literally "photo" must still tell its grid
  // route (/c/photo/photos) apart from its detail route (/c/photo/photo/<id>).
  it("handles a slug named 'photo' without confusing the grid route", () => {
    expect(isPhotoDetailPath("/c/photo/photos", "photo")).toBe(false);
    expect(isPhotoDetailPath("/c/photo/photo/xyz", "photo")).toBe(true);
  });
});
