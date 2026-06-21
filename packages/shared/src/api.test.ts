import { describe, expect, it } from "vitest";
import {
  coercePhotoSort,
  downloadRequestSchema,
  editPhotoSchema,
  photosQuerySchema,
  searchQuerySchema,
  setColorLabelSchema,
  setFavoriteSchema,
} from "./api.js";

describe("photosQuerySchema", () => {
  it("defaults limit to 50 and offset to 0 when absent", () => {
    const parsed = photosQuerySchema.parse({});
    expect(parsed.limit).toBe(50);
    expect(parsed.offset).toBe(0);
  });

  it("coerces a numeric string limit and offset", () => {
    const parsed = photosQuerySchema.parse({ limit: "10", offset: "200" });
    expect(parsed.limit).toBe(10);
    expect(parsed.offset).toBe(200);
  });

  it("rejects limit above 100", () => {
    expect(() => photosQuerySchema.parse({ limit: "1000" })).toThrow();
  });

  it("rejects limit below 1", () => {
    expect(() => photosQuerySchema.parse({ limit: "0" })).toThrow();
  });

  it("rejects a negative offset", () => {
    expect(photosQuerySchema.safeParse({ offset: "-1" }).success).toBe(false);
  });
});

describe("searchQuerySchema", () => {
  it("defaults to empty album list, no q, and offset 0", () => {
    const parsed = searchQuerySchema.parse({});
    expect(parsed.album).toEqual([]);
    expect(parsed.q).toBeUndefined();
    expect(parsed.offset).toBe(0);
    expect(parsed.limit).toBe(50);
  });

  it("wraps a single album string into an array", () => {
    expect(searchQuerySchema.parse({ album: "a1" }).album).toEqual(["a1"]);
  });

  it("passes an album array through", () => {
    expect(searchQuerySchema.parse({ album: ["a1", "a2"] }).album).toEqual(["a1", "a2"]);
  });

  it("trims q and drops empty/whitespace-only q", () => {
    expect(searchQuerySchema.parse({ q: "  beach  " }).q).toBe("beach");
    expect(searchQuerySchema.parse({ q: "   " }).q).toBeUndefined();
  });

  it("coerces offset from a string", () => {
    expect(searchQuerySchema.parse({ offset: "50" }).offset).toBe(50);
  });

  it("rejects limit above 100", () => {
    expect(() => searchQuerySchema.parse({ limit: "1000" })).toThrow();
  });
});

describe("setColorLabelSchema", () => {
  it("accepts photoIds with a valid label", () => {
    const parsed = setColorLabelSchema.parse({ photoIds: ["a", "b"], label: "green" });
    expect(parsed.photoIds).toEqual(["a", "b"]);
    expect(parsed.label).toBe("green");
  });

  it("accepts a null label (clear)", () => {
    expect(setColorLabelSchema.parse({ photoIds: ["a"], label: null }).label).toBeNull();
  });

  it("rejects an empty photoIds array", () => {
    expect(() => setColorLabelSchema.parse({ photoIds: [], label: null })).toThrow();
  });

  it("rejects an empty-string photo id", () => {
    expect(() => setColorLabelSchema.parse({ photoIds: [""], label: null })).toThrow();
  });

  it("rejects an unknown label slug", () => {
    expect(() => setColorLabelSchema.parse({ photoIds: ["a"], label: "magenta" })).toThrow();
  });
});

describe("photosQuerySchema sort", () => {
  it("leaves sort undefined when absent", () => {
    expect(photosQuerySchema.parse({}).sort).toBeUndefined();
  });

  it("accepts each known sort value", () => {
    expect(photosQuerySchema.parse({ sort: "imported-asc" }).sort).toBe("imported-asc");
    expect(photosQuerySchema.parse({ sort: "taken-desc" }).sort).toBe("taken-desc");
  });

  it("rejects an unknown sort", () => {
    expect(() => photosQuerySchema.parse({ sort: "bogus" })).toThrow();
  });
});

describe("searchQuerySchema sort", () => {
  it("accepts a known sort and defaults to undefined", () => {
    expect(searchQuerySchema.parse({}).sort).toBeUndefined();
    expect(searchQuerySchema.parse({ sort: "imported-desc" }).sort).toBe("imported-desc");
  });
});

describe("photosQuerySchema favorite", () => {
  it("leaves favorite undefined when absent", () => {
    expect(photosQuerySchema.parse({}).favorite).toBeUndefined();
  });

  it("parses favorite=true to boolean true", () => {
    expect(photosQuerySchema.parse({ favorite: "true" }).favorite).toBe(true);
  });

  it("parses favorite=false to boolean false", () => {
    expect(photosQuerySchema.parse({ favorite: "false" }).favorite).toBe(false);
  });

  it("rejects a non-boolean favorite", () => {
    expect(photosQuerySchema.safeParse({ favorite: "yes" }).success).toBe(false);
  });
});

describe("setFavoriteSchema", () => {
  it("accepts photoIds with isFavorite true/false", () => {
    expect(setFavoriteSchema.parse({ photoIds: ["a"], isFavorite: true }).isFavorite).toBe(true);
    expect(setFavoriteSchema.parse({ photoIds: ["a", "b"], isFavorite: false }).photoIds).toEqual([
      "a",
      "b",
    ]);
  });

  it("rejects an empty photoIds array", () => {
    expect(() => setFavoriteSchema.parse({ photoIds: [], isFavorite: true })).toThrow();
  });

  it("rejects a missing isFavorite", () => {
    expect(setFavoriteSchema.safeParse({ photoIds: ["a"] }).success).toBe(false);
  });
});

describe("coercePhotoSort", () => {
  it("passes through known sorts", () => {
    expect(coercePhotoSort("imported-desc")).toBe("imported-desc");
    expect(coercePhotoSort("taken-asc")).toBe("taken-asc");
  });

  it("falls back to the default for unknown/empty input", () => {
    expect(coercePhotoSort("bogus")).toBe("imported-desc");
    expect(coercePhotoSort(undefined)).toBe("imported-desc");
    expect(coercePhotoSort(null)).toBe("imported-desc");
  });
});

describe("photosQuerySchema month", () => {
  it("accepts a valid YYYY-MM month", () => {
    expect(photosQuerySchema.parse({ month: "2026-06" }).month).toBe("2026-06");
  });

  it("leaves month undefined when absent", () => {
    expect(photosQuerySchema.parse({}).month).toBeUndefined();
  });

  it("rejects an out-of-range month", () => {
    expect(photosQuerySchema.safeParse({ month: "2026-13" }).success).toBe(false);
  });

  it("rejects a non-zero-padded month", () => {
    expect(photosQuerySchema.safeParse({ month: "2026-6" }).success).toBe(false);
  });

  it("accepts a valid month on searchQuerySchema too", () => {
    expect(searchQuerySchema.parse({ month: "2026-06" }).month).toBe("2026-06");
  });
});

describe("editPhotoSchema", () => {
  it("accepts a valid recipe and null", () => {
    expect(editPhotoSchema.safeParse({ edits: { rotate: 90, flipH: true, flipV: false } }).success).toBe(true);
    expect(editPhotoSchema.safeParse({ edits: null }).success).toBe(true);
  });
  it("rejects bad rotate values", () => {
    expect(editPhotoSchema.safeParse({ edits: { rotate: 45, flipH: false, flipV: false } }).success).toBe(false);
  });
});

describe("downloadRequestSchema", () => {
  it("defaults variant to original", () => {
    const parsed = downloadRequestSchema.parse({ ids: ["a"] });
    expect(parsed.variant).toBe("original");
  });
});
