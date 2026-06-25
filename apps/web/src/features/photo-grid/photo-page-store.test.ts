// apps/web/src/components/photo-grid/photo-page-store.test.ts
import { describe, expect, it } from "vitest";
import {
  createPageStore,
  loadedIds,
  pageIndicesForRange,
  patchPages,
  photoAt,
  photosByIds,
  removeIds,
  resetStore,
  setPage,
} from "./photo-page-store";

type P = { id: string; label?: string };
const items = (base: number, n: number): P[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${base + i}` }));

describe("pageIndicesForRange", () => {
  it("covers every page intersecting the span", () => {
    expect(pageIndicesForRange(0, 0, 100)).toEqual([0]);
    expect(pageIndicesForRange(90, 110, 100)).toEqual([0, 1]);
    expect(pageIndicesForRange(250, 250, 100)).toEqual([2]);
    expect(pageIndicesForRange(-5, 5, 100)).toEqual([0]);
  });
});

describe("setPage + photoAt", () => {
  it("stores a page, exposes items by absolute index, and tracks total", () => {
    let s = createPageStore<P>(100, 10);
    s = setPage(s, 0, items(0, 100), 530);
    s = setPage(s, 2, items(200, 100), 530);
    expect(s.total).toBe(530);
    expect(photoAt(s, 0)?.id).toBe("p0");
    expect(photoAt(s, 99)?.id).toBe("p99");
    expect(photoAt(s, 150)).toBeUndefined(); // page 1 not loaded
    expect(photoAt(s, 200)?.id).toBe("p200");
  });

  it("evicts the least-recently-used page past the cap", () => {
    let s = createPageStore<P>(100, 2);
    s = setPage(s, 0, items(0, 100), 1000); // lru: [0]
    s = setPage(s, 1, items(100, 100), 1000); // lru: [0,1]
    s = setPage(s, 2, items(200, 100), 1000); // over cap → evict 0; lru: [1,2]
    expect(s.pages.has(0)).toBe(false);
    expect(s.pages.has(1)).toBe(true);
    expect(s.pages.has(2)).toBe(true);
  });
});

describe("loadedIds", () => {
  it("returns a sparse array with holes for unloaded indices", () => {
    let s = createPageStore<P>(100, 10);
    s = setPage(s, 0, items(0, 100), 300);
    s = setPage(s, 2, items(200, 100), 300);
    const ids = loadedIds(s);
    expect(ids[0]).toBe("p0");
    expect(ids[99]).toBe("p99");
    expect(ids[150]).toBeUndefined();
    expect(ids[200]).toBe("p200");
  });
});

describe("patchPages", () => {
  it("shallow-merges patch into loaded items whose id matches", () => {
    let s = createPageStore<P>(100, 10);
    s = setPage(s, 0, items(0, 3), 3);
    s = patchPages(s, new Set(["p1"]), { label: "x" });
    expect(photoAt(s, 0)?.label).toBeUndefined();
    expect(photoAt(s, 1)?.label).toBe("x");
  });
});

describe("removeIds", () => {
  it("compacts loaded items up in place — no page is dropped (no refetch flash)", () => {
    let s = createPageStore<P>(100, 10);
    s = setPage(s, 0, items(0, 100), 300);
    s = setPage(s, 1, items(100, 100), 300);
    s = setPage(s, 2, items(200, 100), 300);
    // Remove one id in page 1. Every page stays complete relative to the new
    // total (100 + 100 + 99 = 299), so all pages are kept and the tiles shift up.
    s = removeIds(s, new Set(["p150"]));
    expect(s.total).toBe(299);
    expect(s.pages.has(0)).toBe(true);
    expect(s.pages.has(1)).toBe(true);
    expect(s.pages.has(2)).toBe(true);
    // p150 is gone; p151 slid into index 150, and everything after shifts up by 1.
    expect(photoAt(s, 149)?.id).toBe("p149");
    expect(photoAt(s, 150)?.id).toBe("p151");
    expect(photoAt(s, 151)?.id).toBe("p152");
    expect(photoAt(s, 298)?.id).toBe("p299"); // last item, shifted up one
    expect(photoAt(s, 299)).toBeUndefined(); // past the new total
  });

  it("removes several ids across pages and keeps offsets correct", () => {
    let s = createPageStore<P>(100, 10);
    s = setPage(s, 0, items(0, 100), 200);
    s = setPage(s, 1, items(100, 100), 200);
    s = removeIds(s, new Set(["p0", "p100", "p199"]));
    expect(s.total).toBe(197);
    expect(photoAt(s, 0)?.id).toBe("p1"); // p0 removed, everything shifts up
    expect(photoAt(s, 98)?.id).toBe("p99");
    expect(photoAt(s, 99)?.id).toBe("p101"); // p100 removed
    expect(photoAt(s, 196)?.id).toBe("p198"); // p199 removed, p198 is now last
    expect(photoAt(s, 197)).toBeUndefined();
  });

  it("compacts a single fully-loaded page without dropping it", () => {
    let s = createPageStore<P>(100, 10);
    s = setPage(s, 0, items(0, 100), 100);
    s = removeIds(s, new Set(["p50"]));
    expect(s.total).toBe(99);
    expect(s.pages.has(0)).toBe(true); // last page kept (complete relative to total)
    expect(photoAt(s, 50)?.id).toBe("p51");
    expect(photoAt(s, 98)?.id).toBe("p99");
    expect(photoAt(s, 99)).toBeUndefined();
  });

  it("drops a page left with an internal hole by an adjacent unloaded region", () => {
    // Pages 0 and 2 loaded, page 1 is a hole. Removing from page 0 can't fill
    // page 0's tail (it would come from the unloaded page 1) → page 0 refetches.
    let s = createPageStore<P>(100, 10);
    s = setPage(s, 0, items(0, 100), 300);
    s = setPage(s, 2, items(200, 100), 300);
    s = removeIds(s, new Set(["p10"]));
    expect(s.total).toBe(299);
    expect(s.pages.has(0)).toBe(false); // tail slot can't be filled from the hole
  });

  it("falls back to eviction when a removed id is not loaded (position unknown)", () => {
    let s = createPageStore<P>(100, 10);
    s = setPage(s, 0, items(0, 100), 300);
    s = setPage(s, 1, items(100, 100), 300);
    // p150 is loaded but p999 is not — we can't know p999's position to shift the
    // rest, so fall back to evicting from the lowest affected loaded page.
    s = removeIds(s, new Set(["p150", "p999"]));
    expect(s.total).toBe(298);
    expect(s.pages.has(0)).toBe(true);
    expect(s.pages.has(1)).toBe(false);
  });

  it("only decrements total when no loaded page is affected", () => {
    let s = createPageStore<P>(100, 10);
    s = setPage(s, 0, items(0, 100), 300);
    s = removeIds(s, new Set(["p999"])); // not loaded
    expect(s.total).toBe(299);
    expect(s.pages.has(0)).toBe(true);
  });
});

describe("photosByIds", () => {
  it("returns loaded photos whose id is in the set, skipping unloaded ids", () => {
    let store = createPageStore<{ id: string; n: number }>(2, 10);
    store = setPage(store, 0, [{ id: "a", n: 1 }, { id: "b", n: 2 }], 4);
    store = setPage(store, 1, [{ id: "c", n: 3 }, { id: "d", n: 4 }], 4);
    const got = photosByIds(store, new Set(["a", "c", "zzz"]));
    expect(got.map((p) => p.id).sort()).toEqual(["a", "c"]);
  });

  it("returns an empty array when nothing matches", () => {
    const store = createPageStore<{ id: string }>(2, 10);
    expect(photosByIds(store, new Set(["x"]))).toEqual([]);
  });
});

describe("resetStore", () => {
  it("clears pages, lru, and total so the grid refetches from scratch", () => {
    let store = createPageStore<{ id: string }>(2, 10);
    store = setPage(store, 0, [{ id: "a" }, { id: "b" }], 2);
    const fresh = resetStore(store);
    expect(fresh.pages.size).toBe(0);
    expect(fresh.lru).toEqual([]);
    expect(fresh.total).toBeNull();
    expect(fresh.pageSize).toBe(2);
    expect(fresh.maxPages).toBe(10);
  });
});
