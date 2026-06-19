import { describe, expect, it } from "vitest";
import { isUnchanged, reconcileDeletions } from "./scan.js";

describe("reconcileDeletions", () => {
  it("returns DB paths that are no longer present on disk", () => {
    const dbPaths = ["a.jpg", "b.jpg", "c.jpg"];
    const onDisk = new Set(["a.jpg", "c.jpg"]);
    expect(reconcileDeletions(dbPaths, onDisk)).toEqual(["b.jpg"]);
  });

  it("returns empty when everything is still present", () => {
    expect(reconcileDeletions(["a.jpg"], new Set(["a.jpg"]))).toEqual([]);
  });
});

describe("isUnchanged", () => {
  const st = { size: 100, mtimeMs: 5000.5 };

  it("is true when row size+mtime match and the cache exists", () => {
    expect(isUnchanged({ fileSize: 100, fileMtimeMs: 5000.5 }, st, true)).toBe(true);
  });

  it("is false when the row is unknown (new file)", () => {
    expect(isUnchanged(undefined, st, true)).toBe(false);
  });

  it("is false when size differs", () => {
    expect(isUnchanged({ fileSize: 99, fileMtimeMs: 5000.5 }, st, true)).toBe(false);
  });

  it("is false when mtime differs", () => {
    expect(isUnchanged({ fileSize: 100, fileMtimeMs: 1 }, st, true)).toBe(false);
  });

  it("is false when the cache is missing (forces regeneration)", () => {
    expect(isUnchanged({ fileSize: 100, fileMtimeMs: 5000.5 }, st, false)).toBe(false);
  });

  it("is false when the row has null stats (un-backfilled legacy row)", () => {
    expect(isUnchanged({ fileSize: null, fileMtimeMs: null }, st, true)).toBe(false);
  });
});
