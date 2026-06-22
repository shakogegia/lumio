import { describe, expect, it } from "vitest";
import { detailScopeQuery, parseDetailScope } from "./detail-scope.js";

describe("parseDetailScope", () => {
  it("parses a folder scope with its sort, including the root ('')", () => {
    expect(parseDetailScope({ folder: "2024/trip" })).toEqual({
      kind: "folder",
      dir: "2024/trip",
      sort: "imported-desc",
    });
    expect(parseDetailScope({ folder: "" })).toEqual({
      kind: "folder",
      dir: "",
      sort: "imported-desc",
    });
  });

  it("still parses search / album / library", () => {
    expect(parseDetailScope({ s: "1", album: "a1" }).kind).toBe("search");
    expect(parseDetailScope({ album: "a1" }).kind).toBe("album");
    expect(parseDetailScope({}).kind).toBe("library");
  });
});

describe("detailScopeQuery", () => {
  it("serializes a folder scope (omitting sort when default)", () => {
    const q = detailScopeQuery({
      kind: "folder",
      dir: "a/b",
      sort: "imported-desc",
    });
    expect(q).toBe("folder=a%2Fb");
  });

  it("serializes a folder scope with a non-default sort", () => {
    const q = detailScopeQuery({
      kind: "folder",
      dir: "a/b",
      sort: "taken-asc",
    });
    expect(Object.fromEntries(new URLSearchParams(q))).toEqual({
      folder: "a/b",
      sort: "taken-asc",
    });
  });

  it("round-trips a folder scope through parse", () => {
    const scope = {
      kind: "folder" as const,
      dir: "a/b",
      sort: "imported-desc" as const,
    };
    const sp = Object.fromEntries(new URLSearchParams(detailScopeQuery(scope)));
    expect(parseDetailScope(sp)).toEqual(scope);
  });
});
