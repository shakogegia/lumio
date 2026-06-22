import { describe, expect, it } from "vitest";
import { detailScopeQuery, parseDetailScope } from "./detail-scope.js";

describe("parseDetailScope", () => {
  it("parses a folder scope with its sort, including the root ('')", () => {
    expect(parseDetailScope({ folder: "2024/trip", fsort: "date:desc" })).toEqual({
      kind: "folder",
      dir: "2024/trip",
      sort: "imported-desc",
      fsort: { field: "date", dir: "desc" },
    });
    expect(parseDetailScope({ folder: "" })).toEqual({
      kind: "folder",
      dir: "",
      sort: "imported-desc",
      fsort: { field: "name", dir: "asc" },
    });
  });

  it("still parses search / album / library", () => {
    expect(parseDetailScope({ s: "1", album: "a1" }).kind).toBe("search");
    expect(parseDetailScope({ album: "a1" }).kind).toBe("album");
    expect(parseDetailScope({}).kind).toBe("library");
  });
});

describe("detailScopeQuery", () => {
  it("serializes a folder scope with its sort", () => {
    const q = detailScopeQuery({
      kind: "folder",
      dir: "2024/trip",
      sort: "imported-desc",
      fsort: { field: "date", dir: "desc" },
    });
    expect(Object.fromEntries(new URLSearchParams(q))).toEqual({
      folder: "2024/trip",
      fsort: "date:desc",
    });
  });

  it("round-trips a folder scope through parse", () => {
    const scope = {
      kind: "folder" as const,
      dir: "a/b",
      sort: "imported-desc" as const,
      fsort: { field: "name" as const, dir: "asc" as const },
    };
    const sp = Object.fromEntries(new URLSearchParams(detailScopeQuery(scope)));
    expect(parseDetailScope(sp)).toEqual(scope);
  });
});
