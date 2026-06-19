"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PhotoDTO, PhotosPage } from "@lumio/shared";

async function fetchPage(
  endpoint: string,
  cursor: string | null,
  limit: number,
  extra?: URLSearchParams,
): Promise<PhotosPage> {
  // Clone `extra` so we don't mutate the caller's object; preserves repeated keys (e.g. album).
  const params = new URLSearchParams(extra);
  params.set("limit", String(limit));
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`${endpoint}?${params.toString()}`);
  if (!res.ok) throw new Error("Failed to load photos");
  return res.json();
}

/**
 * Cursor-paginated photo loading for one endpoint. Fetches the first page on
 * mount; callers drive subsequent pages via `loadMore` (e.g. when the grid
 * scrolls near the end). `params` carries extra query params (e.g. search
 * filters) on every request. State resets only on remount — album and search
 * views remount the grid via a `key` when the scope/filter changes.
 */
export function usePhotoPages(endpoint: string, params?: URLSearchParams, pageSize = 50) {
  const [photos, setPhotos] = useState<PhotoDTO[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(false);
  const loadingRef = useRef(false);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || done) return;
    loadingRef.current = true;
    setError(false);
    try {
      const page = await fetchPage(endpoint, cursor, pageSize, params);
      setPhotos((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
      if (!page.nextCursor) setDone(true);
    } catch {
      setError(true);
    } finally {
      loadingRef.current = false;
    }
  }, [endpoint, cursor, done, params, pageSize]);

  const patchPhotos = useCallback((ids: Set<string>, patch: Partial<PhotoDTO>) => {
    setPhotos((prev) => prev.map((p) => (ids.has(p.id) ? { ...p, ...patch } : p)));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { photos, done, error, loadMore, patchPhotos };
}
