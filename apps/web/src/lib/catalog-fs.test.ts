import { describe, expect, it } from "vitest";
import { buildCatalogListing, catalogBreadcrumbs, joinRel } from "./catalog-fs.js";

describe("joinRel", () => {
  it("joins under a parent and handles the root", () => {
    expect(joinRel("", "2024")).toBe("2024");
    expect(joinRel("2024", "trip")).toBe("2024/trip");
  });
});

describe("catalogBreadcrumbs", () => {
  it("always starts with the Library root crumb", () => {
    expect(catalogBreadcrumbs("")).toEqual([{ name: "Library", rel: "" }]);
  });
  it("accumulates rel paths per segment", () => {
    expect(catalogBreadcrumbs("2024/trip")).toEqual([
      { name: "Library", rel: "" },
      { name: "2024", rel: "2024" },
      { name: "trip", rel: "2024/trip" },
    ]);
  });
});

describe("buildCatalogListing", () => {
  it("splits dirs/files, sorts by name, tags images + photoIds", () => {
    const photoIdByRel = new Map([["2024/a.jpg", "p1"]]);
    const listing = buildCatalogListing(
      "2024",
      [
        { name: "b.txt", isDirectory: false, size: 10 },
        { name: "a.jpg", isDirectory: false, size: 20 },
        { name: "sub", isDirectory: true, size: 0 },
      ],
      photoIdByRel,
    );
    expect(listing.dirs).toEqual([{ name: "sub", rel: "2024/sub" }]);
    expect(listing.files).toEqual([
      { name: "a.jpg", rel: "2024/a.jpg", size: 20, isImage: true, photoId: "p1" },
      { name: "b.txt", rel: "2024/b.txt", size: 10, isImage: false, photoId: null },
    ]);
  });
});
