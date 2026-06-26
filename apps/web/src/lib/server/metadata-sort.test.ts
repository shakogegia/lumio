import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PHOTO_SORT } from "@lumio/shared";
import { metadataPageSlice, resolveSort } from "./metadata-sort.js";

describe("metadataPageSlice", () => {
  it("reads entirely within segment 1", () => {
    expect(metadataPageSlice(0, 2, 5)).toEqual({ seg1: { skip: 0, take: 2 }, seg2: null });
  });
  it("straddles the boundary", () => {
    expect(metadataPageSlice(4, 3, 5)).toEqual({ seg1: { skip: 4, take: 1 }, seg2: { skip: 0, take: 2 } });
  });
  it("reads entirely within segment 2", () => {
    expect(metadataPageSlice(7, 3, 5)).toEqual({ seg1: null, seg2: { skip: 2, take: 3 } });
  });
  it("starts exactly at the boundary", () => {
    expect(metadataPageSlice(5, 3, 5)).toEqual({ seg1: null, seg2: { skip: 0, take: 3 } });
  });
  it("handles an empty segment 1", () => {
    expect(metadataPageSlice(0, 2, 0)).toEqual({ seg1: null, seg2: { skip: 0, take: 2 } });
  });
  it("handles a window that exhausts segment 1 with no segment 2 rows requested elsewhere", () => {
    expect(metadataPageSlice(0, 10, 3)).toEqual({ seg1: { skip: 0, take: 3 }, seg2: { skip: 0, take: 7 } });
  });
});

describe("resolveSort", () => {
  const fieldDb = (found: boolean) => ({
    metadataField: { findFirst: vi.fn(async () => (found ? { id: "d1" } : null)) },
  });

  it("returns standard for a fixed sort without querying fields", async () => {
    const db = fieldDb(true);
    const r = await resolveSort("cat1", "taken-asc", db as never);
    expect(r).toEqual({ kind: "standard", sort: "taken-asc" });
    expect(db.metadataField.findFirst).not.toHaveBeenCalled();
  });

  it("returns metadata when the Date field exists and is enabled", async () => {
    const db = fieldDb(true);
    const r = await resolveSort("cat1", "meta:d1:desc", db as never);
    expect(r).toEqual({ kind: "metadata", fieldId: "d1", dir: "desc" });
    expect(db.metadataField.findFirst).toHaveBeenCalledWith({
      where: { id: "d1", catalogId: "cat1", enabled: true, type: "date" },
      select: { id: true },
    });
  });

  it("falls back to the standard default ordering when the field is missing/disabled/wrong-type", async () => {
    const db = fieldDb(false);
    const r = await resolveSort("cat1", "meta:d1:desc", db as never);
    expect(r).toEqual({ kind: "standard", sort: DEFAULT_PHOTO_SORT });
  });
});
