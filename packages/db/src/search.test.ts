import { describe, expect, it } from "vitest";
import { MatchType, RuleOp } from "@lumio/shared";
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

  it("filter rules compose with q + album under AND", () => {
    expect(
      buildSearchWhere({
        album: ["a1"],
        q: "beach",
        filter: { match: MatchType.all, rules: [{ field: "iso", op: RuleOp.gte, value: 800 }] },
      }),
    ).toEqual({
      AND: [
        { albums: { some: { albumId: { in: ["a1"] } } } },
        { path: { contains: "beach", mode: "insensitive" } },
        { iso: { gte: 800 } },
      ],
    });
  });

  it("any-match filter with legacy constraints → legacy AND (filter OR)", () => {
    expect(
      buildSearchWhere({
        album: ["a1"],
        filter: {
          match: MatchType.any,
          rules: [
            { field: "iso", op: RuleOp.gte, value: 800 },
            { field: "camera", op: RuleOp.eq, value: "iPhone" },
          ],
        },
      }),
    ).toEqual({
      AND: [
        { AND: [{ albums: { some: { albumId: { in: ["a1"] } } } }] },
        { OR: [{ iso: { gte: 800 } }, { cameraModel: { equals: "iPhone" } }] },
      ],
    });
  });

  it("any-match filter with no legacy constraints → bare OR", () => {
    expect(
      buildSearchWhere({
        album: [],
        filter: {
          match: MatchType.any,
          rules: [
            { field: "iso", op: RuleOp.gte, value: 800 },
            { field: "lens", op: RuleOp.exists },
          ],
        },
      }),
    ).toEqual({
      OR: [{ iso: { gte: 800 } }, { lensModel: { not: null } }],
    });
  });
});
