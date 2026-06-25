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

/** Loaded photos whose id is in `ids` (arbitrary order). For bulk actions that
 *  need the current state of a selection, e.g. the favorite smart-toggle. Skips
 *  ids on pages that aren't loaded. */
export function photosByIds<T extends { id: string }>(
  store: PageStore<T>,
  ids: Set<string>,
): T[] {
  const out: T[] = [];
  for (const items of store.pages.values()) {
    for (const it of items) if (ids.has(it.id)) out.push(it);
  }
  return out;
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

/** Conservative legacy remove: decrement total and evict every loaded page
 *  at/after the lowest page holding a removed id (their offsets shifted, so they
 *  refetch on re-scroll). Used as the fallback when a removed id isn't loaded. */
function removeByEviction<T extends { id: string }>(
  store: PageStore<T>,
  ids: Set<string>,
  total: number | null,
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
  return { ...store, pages, lru, total };
}

/**
 * Optimistic remove (after a confirmed server delete): drop the matching items
 * and shift the remaining LOADED items up to fill the gaps, keeping every page's
 * offsets correct WITHOUT a refetch — the tiles just slide up, no loading flash.
 * Each kept item moves up by the number of removed items before it. A page is
 * retained only if it stays dense for every index that still exists within it
 * (`min(pageSize, total - pageStart)`); a page left with an internal hole (its
 * tail would have come from an adjacent unloaded region) is dropped so
 * `ensureRange` refetches it — in practice those sit below the viewport.
 *
 * A selection may include ids that have since been LRU-evicted (scrolled far
 * away), whose absolute positions are unknown; compaction can't place the rest
 * correctly then, so it falls back to `removeByEviction`.
 */
export function removeIds<T extends { id: string }>(
  store: PageStore<T>,
  ids: Set<string>,
): PageStore<T> {
  if (ids.size === 0) return store;
  const total = store.total === null ? null : Math.max(0, store.total - ids.size);

  // Flatten loaded items in absolute-index order.
  const loaded: { abs: number; item: T }[] = [];
  const loadedIdSet = new Set<string>();
  for (const [pageIndex, items] of store.pages) {
    const base = pageIndex * store.pageSize;
    items.forEach((it, i) => {
      loaded.push({ abs: base + i, item: it });
      loadedIdSet.add(it.id);
    });
  }
  loaded.sort((a, b) => a.abs - b.abs);

  // Fallback: a removed id isn't loaded → its position is unknown.
  if (![...ids].every((id) => loadedIdSet.has(id))) {
    return removeByEviction(store, ids, total);
  }

  // Compact: place each kept item at (abs − removed-before-it).
  const slots = new Map<number, Map<number, T>>(); // pageIndex → (slot → item)
  let removedBefore = 0;
  for (const { abs, item } of loaded) {
    if (ids.has(item.id)) {
      removedBefore++;
      continue;
    }
    const newAbs = abs - removedBefore;
    const pageIndex = Math.floor(newAbs / store.pageSize);
    const slot = newAbs % store.pageSize;
    let page = slots.get(pageIndex);
    if (!page) {
      page = new Map();
      slots.set(pageIndex, page);
    }
    page.set(slot, item);
  }

  // Keep a page only if it's dense for every index that still exists in it.
  const pages = new Map<number, T[]>();
  for (const [pageIndex, slotMap] of slots) {
    const pageStart = pageIndex * store.pageSize;
    const expected =
      total === null ? store.pageSize : Math.max(0, Math.min(store.pageSize, total - pageStart));
    if (expected === 0) continue;
    const arr = new Array<T>(expected);
    let dense = true;
    for (let slot = 0; slot < expected; slot++) {
      const it = slotMap.get(slot);
      if (it === undefined) {
        dense = false;
        break;
      }
      arr[slot] = it;
    }
    if (dense) pages.set(pageIndex, arr);
  }

  const lru = [
    ...store.lru.filter((p) => pages.has(p)),
    ...[...pages.keys()].filter((p) => !store.lru.includes(p)),
  ];
  return { ...store, pages, lru, total };
}

/** Drop all loaded pages + total, keeping sizing — the grid refetches from
 *  scratch (used for undo/rollback after an optimistic remove). */
export function resetStore<T>(store: PageStore<T>): PageStore<T> {
  return createPageStore<T>(store.pageSize, store.maxPages);
}
