import { describe, expect, it } from "vitest";
import { buildSearchWhere } from "./search.js";

describe("buildSearchWhere", () => {
  it("no filters → empty where (matches everything)", () => {
    expect(buildSearchWhere({ album: [] })).toEqual({});
  });

  it("albums only → membership in any of the albums", () => {
    expect(buildSearchWhere({ album: ["a1", "a2"] })).toEqual({
      AND: [{ albums: { some: { albumId: { in: ["a1", "a2"] } } } }],
    });
  });

  it("q only → case-insensitive path contains", () => {
    expect(buildSearchWhere({ album: [], q: "beach" })).toEqual({
      AND: [{ path: { contains: "beach", mode: "insensitive" } }],
    });
  });

  it("albums + q → AND of both clauses", () => {
    expect(buildSearchWhere({ album: ["a1"], q: "beach" })).toEqual({
      AND: [
        { albums: { some: { albumId: { in: ["a1"] } } } },
        { path: { contains: "beach", mode: "insensitive" } },
      ],
    });
  });
});
