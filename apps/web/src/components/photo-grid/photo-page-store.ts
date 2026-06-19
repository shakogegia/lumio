// apps/web/src/components/photo-grid/photo-page-store.ts

/**
 * Sparse, page-indexed photo store for the virtualized grid. Pure and
 * React-free so the page math, eviction, and optimistic mutations are unit
 * tested directly. The hook (`use-photo-pages.ts`) holds one of these in state.
 */
export interface PageStore<T> {
  pageSize: number;
  maxPages: number;
  total: number | null;
  pages: Map<number, T[]>;
  /** Page indices ordered least-recently-used first. */
  lru: number[];
}

export function createPageStore<T>(pageSize: number, maxPages: number): PageStore<T> {
  return { pageSize, maxPages, total: null, pages: new Map(), lru: [] };
}

/** Inclusive page indices covering the absolute-index span (clamped to >= 0). */
export function pageIndicesForRange(
  startIndex: number,
  endIndex: number,
  pageSize: number,
): number[] {
  const lo = Math.max(0, Math.floor(startIndex / pageSize));
  const hi = Math.max(0, Math.floor(endIndex / pageSize));
  const out: number[] = [];
  for (let p = lo; p <= hi; p++) out.push(p);
  return out;
}

export function photoAt<T>(store: PageStore<T>, index: number): T | undefined {
  if (index < 0) return undefined;
  return store.pages.get(Math.floor(index / store.pageSize))?.[index % store.pageSize];
}

function touch(lru: number[], pageIndex: number): number[] {
  const next = lru.filter((p) => p !== pageIndex);
  next.push(pageIndex);
  return next;
}

/** Store a fetched page, refresh total, and evict LRU pages past the cap. */
export function setPage<T>(
  store: PageStore<T>,
  pageIndex: number,
  items: T[],
  total: number,
): PageStore<T> {
  const pages = new Map(store.pages);
  pages.set(pageIndex, items);
  let lru = touch(store.lru, pageIndex);
  while (lru.length > store.maxPages) {
    const evict = lru[0]!;
    lru = lru.slice(1);
    pages.delete(evict);
  }
  return { ...store, pages, lru, total };
}

/** Sparse array (holes for unloaded indices) of ids, for selection-range math. */
export function loadedIds<T extends { id: string }>(store: PageStore<T>): string[] {
  const ids: string[] = [];
  for (const [pageIndex, items] of store.pages) {
    const base = pageIndex * store.pageSize;
    items.forEach((it, i) => {
      ids[base + i] = it.id;
    });
  }
  return ids;
}

/** Optimistic patch: shallow-merge `patch` into loaded items whose id is in `ids`. */
export function patchPages<T extends { id: string }>(
  store: PageStore<T>,
  ids: Set<string>,
  patch: Partial<T>,
): PageStore<T> {
  const pages = new Map<number, T[]>();
  for (const [pageIndex, items] of store.pages) {
    pages.set(
      pageIndex,
      items.map((it) => (ids.has(it.id) ? { ...it, ...patch } : it)),
    );
  }
  return { ...store, pages };
}

/**
 * Optimistic remove (after a confirmed server delete): decrement total by the
 * number removed, and evict every loaded page at/after the lowest page holding a
 * removed id — those pages' offsets have shifted, so they refetch correctly on
 * re-scroll. Pages before it are untouched (nothing shifted them).
 */
export function removeIds<T extends { id: string }>(
  store: PageStore<T>,
  ids: Set<string>,
): PageStore<T> {
  let lowestAffected = Infinity;
  for (const [pageIndex, items] of store.pages) {
    if (items.some((it) => ids.has(it.id))) {
      lowestAffected = Math.min(lowestAffected, pageIndex);
    }
  }
  const pages = new Map<number, T[]>();
  let lru = store.lru;
  for (const [pageIndex, items] of store.pages) {
    if (pageIndex >= lowestAffected) {
      lru = lru.filter((p) => p !== pageIndex);
      continue;
    }
    pages.set(pageIndex, items);
  }
  const total = store.total === null ? null : Math.max(0, store.total - ids.size);
  return { ...store, pages, lru, total };
}
