import { describe, expect, it } from "vitest";
import { reconcileDeletions } from "./scan.js";

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
