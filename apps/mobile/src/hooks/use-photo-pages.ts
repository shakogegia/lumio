import { useCallback, useEffect, useRef, useState } from "react";
import type { PhotoDTO, PhotosPage } from "@lumio/shared";
import { hasMore, mergeById } from "@/lib/photo-pages";

/** A page fetcher bound to a data source (catalog, album, …). `null` means the
 *  source isn't ready yet (no server/catalog) — the hook stays idle. */
export type FetchPage = ((offset: number, limit: number) => Promise<PhotosPage>) | null;

/**
 * Source-agnostic infinite-scroll loader. Pass a memoized `fetchPage`: when its
 * identity changes (a new data source), the list reloads from offset 0. Callers
 * must wrap `fetchPage` in useMemo keyed on the source so it is stable per source.
 *
 * Reusable by any photo collection — the Photos tab binds it to the active
 * catalog; an album screen later binds it to an album. Only `fetchPage` differs.
 */
export function usePhotoPages({
  fetchPage,
  pageSize = 100,
}: {
  fetchPage: FetchPage;
  pageSize?: number;
}) {
  const [photos, setPhotos] = useState<PhotoDTO[]>([]);
  const [total, setTotal] = useState(0);
  // Starts true so the very first render shows a spinner before the first page
  // resolves. Only ever flipped inside deferred promise callbacks (see `run`).
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs hold the live cursor so loadMore reads current values without being
  // recreated on every render and without racing concurrent pages. (Reading/
  // writing refs in callbacks — not during render — is lint-safe.)
  const offsetRef = useRef(0);
  const loadedRef = useRef(0);
  const totalRef = useRef(0);
  const inFlightRef = useRef(false);

  // Loads the first page. Synchronous body touches only refs (never setState),
  // so it is safe to call straight from the effect — every setState happens in a
  // deferred .then/.catch/.finally, matching the catalog-context pattern that the
  // React Compiler lint requires.
  const run = useCallback(() => {
    if (!fetchPage) return;
    offsetRef.current = 0;
    loadedRef.current = 0;
    totalRef.current = 0;
    inFlightRef.current = true;
    fetchPage(0, pageSize)
      .then((page) => {
        setPhotos(page.items);
        setTotal(page.total);
        setError(null);
        loadedRef.current = page.items.length;
        totalRef.current = page.total;
        offsetRef.current = page.items.length;
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't load photos."))
      .finally(() => {
        inFlightRef.current = false;
        setIsLoading(false);
      });
  }, [fetchPage, pageSize]);

  const loadMore = useCallback(() => {
    if (!fetchPage) return;
    if (inFlightRef.current) return;
    if (!hasMore(loadedRef.current, totalRef.current)) return;
    inFlightRef.current = true;
    setIsLoadingMore(true);
    fetchPage(offsetRef.current, pageSize)
      .then((page) => {
        setPhotos((prev) => mergeById(prev, page.items));
        setTotal(page.total);
        totalRef.current = page.total;
        loadedRef.current += page.items.length;
        offsetRef.current += page.items.length;
      })
      .catch(() => {
        // Keep what we have; a later scroll retries. Don't blank the grid.
      })
      .finally(() => {
        inFlightRef.current = false;
        setIsLoadingMore(false);
      });
  }, [fetchPage, pageSize]);

  // Manual reload (e.g. a Retry button). This is an event handler, not an effect,
  // so the synchronous spinner/clear is allowed here.
  const refetch = useCallback(() => {
    setIsLoading(true);
    setError(null);
    run();
  }, [run]);

  // Reload whenever the data source changes. run's identity changes exactly when
  // fetchPage does, so depending on it reloads once per source change.
  useEffect(() => {
    run();
  }, [run]);

  return { photos, total, isLoading, isLoadingMore, error, loadMore, refetch };
}
