import { describe, expect, it } from "vitest";
import { albumPhotosSchema, createAlbumSchema, deleteAlbumsSchema, renameAlbumSchema, setAlbumCoverSchema, updateSmartAlbumRulesSchema } from "./albums.js";
import { filterSetSchema } from "./filters.js";

describe("filterSetSchema (smart album rules)", () => {
  it("parses last_30_days rule", () => {
    const result = filterSetSchema.parse({
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
    const result = filterSetSchema.parse({
      match: "any",
      rules: [{ field: "exif.cameraModel", op: "eq", value: "iPhone" }],
    });
    expect(result.match).toBe("any");
    const rule = result.rules[0];
    expect(rule?.field).toBe("exif.cameraModel");
    expect(rule?.op).toBe("eq");
    expect(rule?.value).toBe("iPhone");
  });

  it("rejects cameraModel eq rule missing value", () => {
    expect(() =>
      filterSetSchema.parse({
        match: "all",
        rules: [{ field: "exif.cameraModel", op: "eq" }],
      }),
    ).toThrow();
  });

  it("accepts empty rules array (min-1 now enforced at createAlbumSchema level)", () => {
    // filterSetSchema itself allows empty rules; the min-1 check is in createAlbumSchema
    expect(() =>
      filterSetSchema.parse({ match: "all", rules: [] }),
    ).not.toThrow();
  });
});

describe("updateSmartAlbumRulesSchema", () => {
  it("accepts a valid rules payload", () => {
    const result = updateSmartAlbumRulesSchema.parse({
      rules: { match: "all", rules: [{ field: "takenAt", op: "last_30_days" }] },
    });
    expect(result.rules.match).toBe("all");
    expect(result.rules.rules).toHaveLength(1);
  });

  it("rejects missing rules key", () => {
    expect(() => updateSmartAlbumRulesSchema.parse({})).toThrow();
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

describe("albumPhotosSchema", () => {
  it("accepts a non-empty photoIds array", () => {
    const result = albumPhotosSchema.parse({ photoIds: ["p1", "p2"] });
    expect(result.photoIds).toEqual(["p1", "p2"]);
  });

  it("rejects an empty photoIds array", () => {
    expect(() => albumPhotosSchema.parse({ photoIds: [] })).toThrow();
  });

  it("rejects a photoIds entry that is an empty string", () => {
    expect(() => albumPhotosSchema.parse({ photoIds: [""] })).toThrow();
  });
});

describe("setAlbumCoverSchema", () => {
  it("accepts a non-empty coverPhotoId", () => {
    expect(setAlbumCoverSchema.parse({ coverPhotoId: "p1" })).toEqual({ coverPhotoId: "p1" });
  });

  it("rejects an empty coverPhotoId", () => {
    expect(() => setAlbumCoverSchema.parse({ coverPhotoId: "" })).toThrow();
  });

  it("rejects a missing coverPhotoId", () => {
    expect(() => setAlbumCoverSchema.parse({})).toThrow();
  });
});

describe("deleteAlbumsSchema", () => {
  it("accepts a non-empty ids array", () => {
    const result = deleteAlbumsSchema.parse({ ids: ["a1", "a2"] });
    expect(result.ids).toEqual(["a1", "a2"]);
  });

  it("rejects an empty ids array", () => {
    expect(() => deleteAlbumsSchema.parse({ ids: [] })).toThrow();
  });

  it("rejects an ids entry that is an empty string", () => {
    expect(() => deleteAlbumsSchema.parse({ ids: [""] })).toThrow();
  });
});

describe("renameAlbumSchema", () => {
  it("accepts a non-empty name", () => {
    expect(renameAlbumSchema.parse({ name: "Trip" }).name).toBe("Trip");
  });
  it("rejects an empty name", () => {
    expect(() => renameAlbumSchema.parse({ name: "" })).toThrow();
  });
});
