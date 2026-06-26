import { describe, expect, it } from "vitest";
import { MatchType, RuleOp, ValueType, type FieldDef, type SearchRegistry } from "@lumio/shared";
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

describe("buildSearchWhere — metadata registry", () => {
  const reg: SearchRegistry = new Map<string, FieldDef>([
    ["film", { key: "film", label: "Film", type: ValueType.string, storage: { kind: "metadata", fieldId: "f1" }, ops: [] }],
  ]);
  const NOW = new Date("2026-06-26T00:00:00Z");

  it("compiles a known metadata field via the registry", () => {
    const where = buildSearchWhere(
      { album: [], filter: { match: MatchType.all, rules: [{ field: "film", op: RuleOp.eq, value: "Portra" }] } },
      NOW, reg,
    );
    expect(JSON.stringify(where)).toContain('"fieldId":"f1"');
  });

  it("drops a filter rule whose field is not a configured field", () => {
    const where = buildSearchWhere(
      { album: [], filter: { match: MatchType.all, rules: [{ field: "exif.SecretTag", op: RuleOp.eq, value: "x" }] } },
      NOW, reg,
    );
    expect(where).toEqual({});
  });

  it("drops a filter rule whose op is not allowed for the configured field", () => {
    const r2: SearchRegistry = new Map<string, FieldDef>([
      ["fmt", { key: "fmt", label: "Format", type: ValueType.string, storage: { kind: "metadata", fieldId: "f9" }, ops: [RuleOp.in_list] }],
    ]);
    const where = buildSearchWhere(
      { album: [], filter: { match: MatchType.all, rules: [{ field: "fmt", op: RuleOp.contains, value: "x" }] } },
      new Date("2026-06-26T00:00:00Z"), r2,
    );
    expect(where).toEqual({});
  });
});
