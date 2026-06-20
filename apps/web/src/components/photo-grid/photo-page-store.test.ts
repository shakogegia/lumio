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
  it("decrements total and evicts pages at/after the lowest affected page", () => {
    let s = createPageStore<P>(100, 10);
    s = setPage(s, 0, items(0, 100), 300);
    s = setPage(s, 1, items(100, 100), 300);
    s = setPage(s, 2, items(200, 100), 300);
    // remove one id living in page 1 → page 0 stays, pages 1 & 2 evicted (offsets shift)
    s = removeIds(s, new Set(["p150"]));
    expect(s.total).toBe(299);
    expect(s.pages.has(0)).toBe(true);
    expect(s.pages.has(1)).toBe(false);
    expect(s.pages.has(2)).toBe(false);
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
