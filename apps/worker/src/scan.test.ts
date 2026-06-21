import { describe, expect, it } from "vitest";
import { planAfterHash, planScan, reconcileDeletions } from "./scan.js";

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

describe("planScan", () => {
  const st = { size: 100, mtimeMs: 5000.5 };

  it("is 'new' when there is no row", () => {
    expect(planScan(undefined, st, false)).toBe("new");
  });

  it("is 'skip' when size+mtime match and the cache exists", () => {
    expect(planScan({ fileSize: 100, fileMtimeMs: 5000.5 }, st, true)).toBe("skip");
  });

  it("is 'heal' when size+mtime match but the cache is missing", () => {
    expect(planScan({ fileSize: 100, fileMtimeMs: 5000.5 }, st, false)).toBe("heal");
  });

  it("is 'check-hash' when size differs", () => {
    expect(planScan({ fileSize: 99, fileMtimeMs: 5000.5 }, st, true)).toBe("check-hash");
  });

  it("is 'check-hash' when mtime differs", () => {
    expect(planScan({ fileSize: 100, fileMtimeMs: 1 }, st, true)).toBe("check-hash");
  });

});

describe("planAfterHash", () => {
  it("re-imports when the content hash changed", () => {
    expect(planAfterHash(false, true)).toBe("reimport");
    expect(planAfterHash(false, false)).toBe("reimport");
  });

  it("refreshes the stamp only when the hash matches and the cache exists", () => {
    expect(planAfterHash(true, true)).toBe("stamp-only");
  });

  it("heals when the hash matches but the cache is missing", () => {
    expect(planAfterHash(true, false)).toBe("heal");
  });
});
