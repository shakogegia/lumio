import { describe, expect, it } from "vitest";
import { sanitizeMetadata } from "./metadata.js";

describe("sanitizeMetadata", () => {
  it("converts Dates to ISO strings", () => {
    const d = new Date("2024-03-14T09:26:53.000Z");
    expect(sanitizeMetadata(d)).toBe("2024-03-14T09:26:53.000Z");
  });

  it("drops Buffers, typed arrays and functions", () => {
    const out = sanitizeMetadata({
      keep: "yes",
      buf: Buffer.from([1, 2, 3]),
      arr: new Uint8Array([4, 5]),
      fn: () => 1,
    }) as Record<string, unknown>;
    expect(out).toEqual({ keep: "yes" });
  });

  it("recurses nested objects and arrays and preserves primitives", () => {
    const out = sanitizeMetadata({
      n: 2.8,
      b: true,
      nested: { d: new Date("2020-01-01T00:00:00.000Z"), list: [1, "x", Buffer.from([0])] },
    });
    expect(out).toEqual({
      n: 2.8,
      b: true,
      nested: { d: "2020-01-01T00:00:00.000Z", list: [1, "x"] },
    });
  });

  it("produces JSON-serialisable output", () => {
    const out = sanitizeMetadata({ d: new Date(), buf: Buffer.from([1]), bad: NaN });
    expect(() => JSON.stringify(out)).not.toThrow();
  });

  it("passes null through unchanged", () => {
    expect(sanitizeMetadata(null)).toBeNull();
    expect(sanitizeMetadata({ gps: null })).toEqual({ gps: null });
  });

  it("drops invalid Dates", () => {
    expect(sanitizeMetadata(new Date("not a date"))).toBeUndefined();
    expect(sanitizeMetadata({ ts: new Date("not a date") })).toEqual({});
  });
});
