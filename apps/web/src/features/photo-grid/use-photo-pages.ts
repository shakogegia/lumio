"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PhotoDTO } from "@lumio/shared";
import {
  createPageStore,
  loadedIds as loadedIdsOf,
  pageIndicesForRange,
  patchPages,
  photoAt as photoAtOf,
  photosByIds,
  removeIds,
  resetStore,
  setPage,
  type PageStore,
} from "./photo-page-store";

/** Keep at most this many pages in memory; LRU-evict the rest (refetched on
 *  return). Bounds memory regardless of library size. */
const MAX_PAGES = 60;

async function fetchPage(
  endpoint: string,
  offset: number,
  limit: number,
  extra?: URLSearchParams,
): Promise<{ items: PhotoDTO[]; total: number }> {
  const params = new URLSearchParams(extra);
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  const res = await fetch(`${endpoint}?${params.toString()}`);
  if (!res.ok) throw new Error("Failed to load photos");
  return res.json();
}

/**
 * Offset-paginated, randomly-addressable photo loading for one endpoint. Holds a
 * sparse page store sized to `total`; `ensureRange` fetches whichever pages cover
 * the requested absolute-index span (deduped via an in-flight set). State resets
 * only on remount — album/search views remount via a `key` when scope changes.
 */
export function usePhotoPages(endpoint: string, params?: URLSearchParams, pageSize = 50) {
  const [store, setStore] = useState<PageStore<PhotoDTO>>(() =>
    createPageStore<PhotoDTO>(pageSize, MAX_PAGES),
  );
  const [error, setError] = useState(false);
  const inFlight = useRef<Set<number>>(new Set());
  const lastRange = useRef<[number, number]>([0, 0]);
  // Bumped by every optimistic mutation (patch/remove). A page fetch captures
  // the generation at dispatch and drops its result if a mutation landed while
  // it was in flight — otherwise a stale (pre-delete) `total` or a stale-offset
  // page could clobber the corrected store. Dropped pages refetch on the next
  // `ensureRange` (the mutation's re-render triggers it) with correct offsets.
  const mutationGen = useRef(0);

  const ensureRange = useCallback(
    (startIndex: number, endIndex: number) => {
      lastRange.current = [startIndex, endIndex];
      const needed = pageIndicesForRange(startIndex, endIndex, pageSize).filter(
        (p) => !store.pages.has(p) && !inFlight.current.has(p),
      );
      for (const p of needed) {
        inFlight.current.add(p);
        const gen = mutationGen.current;
        fetchPage(endpoint, p * pageSize, pageSize, params)
          .then((page) => {
            if (gen !== mutationGen.current) return; // mutation landed mid-flight; drop stale result
            setStore((prev) => setPage(prev, p, page.items, page.total));
            setError(false);
          })
          .catch(() => setError(true))
          .finally(() => {
            inFlight.current.delete(p);
          });
      }
    },
    [endpoint, params, pageSize, store.pages],
  );

  // First page (also yields total). Re-runs harmlessly on store changes — page 0
  // is then already loaded, so it is a no-op.
  useEffect(() => {
    ensureRange(0, 0);
  }, [ensureRange]);

  const photoAt = useCallback((index: number) => photoAtOf(store, index), [store]);
  const getLoadedIds = useCallback(() => loadedIdsOf(store), [store]);
  const getPhotos = useCallback((ids: Set<string>) => photosByIds(store, ids), [store]);
  const patchPhotos = useCallback((ids: Set<string>, patch: Partial<PhotoDTO>) => {
    mutationGen.current += 1;
    setStore((prev) => patchPages(prev, ids, patch));
  }, []);
  const removePhotos = useCallback((ids: Set<string>) => {
    mutationGen.current += 1;
    setStore((prev) => removeIds(prev, ids));
  }, []);
  const reload = useCallback(() => {
    mutationGen.current += 1; // drop any in-flight page fetch
    setStore((prev) => resetStore(prev));
  }, []);
  const retry = useCallback(() => {
    setError(false);
    const [s, e] = lastRange.current;
    ensureRange(s, e);
  }, [ensureRange]);

  return { total: store.total, photoAt, getLoadedIds, getPhotos, ensureRange, patchPhotos, removePhotos, reload, error, retry };
}
