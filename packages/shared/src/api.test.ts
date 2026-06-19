import { describe, expect, it } from "vitest";
import { photosQuerySchema, searchQuerySchema, setColorLabelSchema } from "./api.js";

describe("photosQuerySchema", () => {
  it("defaults limit to 50 when absent", () => {
    const parsed = photosQuerySchema.parse({});
    expect(parsed.limit).toBe(50);
    expect(parsed.cursor).toBeUndefined();
  });

  it("coerces a numeric string limit and passes cursor through", () => {
    const parsed = photosQuerySchema.parse({ limit: "10", cursor: "abc" });
    expect(parsed.limit).toBe(10);
    expect(parsed.cursor).toBe("abc");
  });

  it("rejects limit above 100", () => {
    expect(() => photosQuerySchema.parse({ limit: "1000" })).toThrow();
  });

  it("rejects limit below 1", () => {
    expect(() => photosQuerySchema.parse({ limit: "0" })).toThrow();
  });
});

describe("searchQuerySchema", () => {
  it("defaults to empty album list and no q/cursor", () => {
    const parsed = searchQuerySchema.parse({});
    expect(parsed.album).toEqual([]);
    expect(parsed.q).toBeUndefined();
    expect(parsed.cursor).toBeUndefined();
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
