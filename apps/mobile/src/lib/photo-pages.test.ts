import { describe, it, expect } from "vitest";
import { mergeById, hasMore } from "./photo-pages";

describe("mergeById", () => {
  it("returns incoming when prev is empty", () => {
    expect(mergeById([], [{ id: "a" }])).toEqual([{ id: "a" }]);
  });
  it("appends new items", () => {
    expect(mergeById([{ id: "a" }], [{ id: "b" }])).toEqual([{ id: "a" }, { id: "b" }]);
  });
  it("drops duplicates by id", () => {
    expect(mergeById([{ id: "a" }], [{ id: "a" }, { id: "b" }])).toEqual([{ id: "a" }, { id: "b" }]);
  });
});

describe("hasMore", () => {
  it("is true when loaded < total", () => expect(hasMore(50, 100)).toBe(true));
  it("is false when loaded === total", () => expect(hasMore(100, 100)).toBe(false));
  it("is false when loaded > total", () => expect(hasMore(120, 100)).toBe(false));
});
