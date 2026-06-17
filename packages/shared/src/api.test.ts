import { describe, expect, it } from "vitest";
import { photosQuerySchema } from "./api.js";

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
