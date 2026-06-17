import { describe, expect, it } from "vitest";
import { createAlbumSchema, smartRulesSchema } from "./albums.js";

describe("smartRulesSchema", () => {
  it("parses last_30_days rule", () => {
    const result = smartRulesSchema.parse({
      match: "all",
      rules: [{ field: "takenAt", op: "last_30_days" }],
    });
    expect(result.match).toBe("all");
    expect(result.rules).toHaveLength(1);
    const rule = result.rules[0];
    expect(rule?.field).toBe("takenAt");
    expect(rule?.op).toBe("last_30_days");
  });

  it("parses cameraModel eq rule", () => {
    const result = smartRulesSchema.parse({
      match: "any",
      rules: [{ field: "exif.cameraModel", op: "eq", value: "iPhone" }],
    });
    expect(result.match).toBe("any");
    const rule = result.rules[0];
    expect(rule?.field).toBe("exif.cameraModel");
    expect(rule?.op).toBe("eq");
    // @ts-expect-error -- discriminated union, value exists on cameraEq branch
    expect(rule?.value).toBe("iPhone");
  });

  it("rejects cameraModel rule missing value", () => {
    expect(() =>
      smartRulesSchema.parse({
        match: "all",
        rules: [{ field: "exif.cameraModel", op: "eq" }],
      }),
    ).toThrow();
  });

  it("rejects empty rules array", () => {
    expect(() =>
      smartRulesSchema.parse({ match: "all", rules: [] }),
    ).toThrow();
  });
});

describe("createAlbumSchema", () => {
  it("rejects isSmart:true with no rules", () => {
    expect(() =>
      createAlbumSchema.parse({ name: "x", isSmart: true }),
    ).toThrow();
  });

  it("rejects regular album that supplies rules", () => {
    expect(() =>
      createAlbumSchema.parse({
        name: "x",
        rules: { match: "all", rules: [{ field: "takenAt", op: "last_30_days" }] },
      }),
    ).toThrow();
  });

  it("accepts plain name (isSmart defaults false)", () => {
    const result = createAlbumSchema.parse({ name: "x" });
    expect(result.name).toBe("x");
    expect(result.isSmart).toBe(false);
    expect(result.rules).toBeUndefined();
  });

  it("accepts smart album with valid rules", () => {
    const result = createAlbumSchema.parse({
      name: "x",
      isSmart: true,
      rules: {
        match: "all",
        rules: [{ field: "takenAt", op: "last_30_days" }],
      },
    });
    expect(result.isSmart).toBe(true);
    expect(result.rules?.match).toBe("all");
  });
});
