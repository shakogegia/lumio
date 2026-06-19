"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PhotoDTO, PhotosPage } from "@lumio/shared";

async function fetchPage(endpoint: string, cursor: string | null): Promise<PhotosPage> {
  const params = new URLSearchParams({ limit: "50" });
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`${endpoint}?${params.toString()}`);
  if (!res.ok) throw new Error("Failed to load photos");
  return res.json();
}

/**
 * Cursor-paginated photo loading for one endpoint. Fetches the first page on
 * mount; callers drive subsequent pages via `loadMore` (e.g. when the grid
 * scrolls near the end). State resets only on remount — album views remount the
 * grid via a `key` when the album changes.
 */
export function usePhotoPages(endpoint: string) {
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
      const page = await fetchPage(endpoint, cursor);
      setPhotos((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
      if (!page.nextCursor) setDone(true);
    } catch {
      setError(true);
    } finally {
      loadingRef.current = false;
    }
  }, [endpoint, cursor, done]);

  useEffect(() => {
    void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { photos, done, error, loadMore };
}
