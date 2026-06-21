import { describe, expect, it } from "vitest";
import { detailScopeQuery, parseDetailScope } from "./photo-detail-loader";

describe("parseDetailScope", () => {
  it("defaults to a library scope with the default sort", () => {
    expect(parseDetailScope({})).toEqual({ kind: "library", sort: "imported-desc" });
  });

  it("reads a valid sort", () => {
    expect(parseDetailScope({ sort: "imported-asc" })).toEqual({
      kind: "library",
      sort: "imported-asc",
    });
  });

  it("falls back to the default for an invalid sort", () => {
    expect(parseDetailScope({ sort: "bogus" })).toEqual({ kind: "library", sort: "imported-desc" });
  });

  it("carries the sort on an album scope", () => {
    expect(parseDetailScope({ album: "alb1", sort: "taken-asc" })).toEqual({
      kind: "album",
      albumId: "alb1",
      sort: "taken-asc",
    });
  });

  it("carries the sort on a search scope", () => {
    expect(parseDetailScope({ s: "1", album: ["a", "b"], q: "x", sort: "imported-desc" })).toEqual({
      kind: "search",
      albums: ["a", "b"],
      q: "x",
      sort: "imported-desc",
    });
  });
});

describe("detailScopeQuery", () => {
  it("emits an empty string for a default-sort library scope", () => {
    expect(detailScopeQuery({ kind: "library", sort: "imported-desc" })).toBe("");
  });

  it("emits only sort for a non-default library scope", () => {
    expect(detailScopeQuery({ kind: "library", sort: "imported-asc" })).toBe("sort=imported-asc");
  });

  it("keeps the album and omits a default sort", () => {
    expect(detailScopeQuery({ kind: "album", albumId: "alb1", sort: "imported-desc" })).toBe(
      "album=alb1",
    );
  });

  it("appends a non-default sort to an album scope", () => {
    expect(detailScopeQuery({ kind: "album", albumId: "alb1", sort: "taken-asc" })).toBe(
      "album=alb1&sort=taken-asc",
    );
  });

  it("round-trips a search scope with a sort", () => {
    const scope = parseDetailScope({ s: "1", album: ["a"], q: "x", sort: "imported-asc" });
    expect(detailScopeQuery(scope)).toBe("s=1&album=a&q=x&sort=imported-asc");
  });
});
