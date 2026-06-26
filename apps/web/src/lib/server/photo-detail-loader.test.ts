import { DEFAULT_PHOTO_SORT, MatchType, RuleOp } from "@lumio/shared";
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

describe("filter param handling", () => {
  it("parseDetailScope parses a valid filter param into the search scope", () => {
    const scope = parseDetailScope({
      s: "1",
      filter: JSON.stringify({ match: "all", rules: [{ field: "iso", op: "gt", value: 800 }] }),
    });
    expect(scope).toMatchObject({
      kind: "search",
      filter: { match: "all", rules: [{ field: "iso", op: "gt", value: 800 }] },
    });
  });

  it("parseDetailScope drops an invalid filter param (no throw)", () => {
    const scope = parseDetailScope({ s: "1", filter: "{not json" });
    expect(scope).toMatchObject({ kind: "search" });
    expect((scope as { filter?: unknown }).filter).toBeUndefined();
  });

  it("parseDetailScope drops a schema-invalid filter (valid JSON, bad rule)", () => {
    const scope = parseDetailScope({
      s: "1",
      // album + gt is invalid per filterSetSchema (gt not allowed on album)
      filter: JSON.stringify({ match: "all", rules: [{ field: "album", op: "gt", value: 1 }] }),
    });
    expect(scope).toMatchObject({ kind: "search" });
    expect((scope as { filter?: unknown }).filter).toBeUndefined();
  });

  it("detailScopeQuery re-emits the filter param for search scopes", () => {
    const qs = detailScopeQuery({
      kind: "search",
      albums: [],
      filter: { match: MatchType.all, rules: [{ field: "iso", op: RuleOp.gt, value: 800 }] },
      sort: DEFAULT_PHOTO_SORT,
    });
    expect(qs).toContain("s=1");
    expect(qs).toContain("filter=");
  });

  it("detailScopeQuery filter round-trips through parseDetailScope", () => {
    const filter = { match: MatchType.all, rules: [{ field: "iso", op: RuleOp.gt, value: 800 }] };
    const qs = detailScopeQuery({ kind: "search", albums: ["a1"], filter, sort: DEFAULT_PHOTO_SORT });
    const sp = Object.fromEntries(new URLSearchParams(qs));
    const back = parseDetailScope(sp);
    expect(back).toMatchObject({ kind: "search", albums: ["a1"], filter });
  });
});
