import { describe, expect, it } from "vitest";
import { breadcrumbSegments } from "./fs-browse.js";

describe("breadcrumbSegments", () => {
  it("returns just the root crumb at the root", () => {
    expect(breadcrumbSegments("/media", "/media", "Media")).toEqual([
      { name: "Media", path: "/media" },
    ]);
  });

  it("breaks the below-root portion into clickable ancestors", () => {
    expect(breadcrumbSegments("/media/2024/trip", "/media", "Media")).toEqual([
      { name: "Media", path: "/media" },
      { name: "2024", path: "/media/2024" },
      { name: "trip", path: "/media/2024/trip" },
    ]);
  });

  it("tolerates a trailing slash on the root", () => {
    expect(breadcrumbSegments("/media/a", "/media/", "Media")).toEqual([
      { name: "Media", path: "/media" },
      { name: "a", path: "/media/a" },
    ]);
  });

  it("collapses to the root crumb when the path is not below root", () => {
    expect(breadcrumbSegments("/elsewhere", "/media", "Media")).toEqual([
      { name: "Media", path: "/media" },
    ]);
  });
});
