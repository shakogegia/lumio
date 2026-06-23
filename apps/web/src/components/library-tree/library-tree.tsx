"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { AlbumSummaryDTO, FolderDTO } from "@lumio/shared";
import { catalogApiUrl } from "@/lib/catalog-api";
import { useCatalog } from "@/components/providers/catalog-context";

export interface LibraryTree {
  folders: FolderDTO[];
  albums: AlbumSummaryDTO[];
  loading: boolean;
  error: boolean;
  reload: () => void;
}

const LibraryTreeContext = createContext<LibraryTree | null>(null);

const INVALIDATE_EVENT = "library-tree:invalidate";

/**
 * Ask the shared LibraryTreeProvider to refetch. Call this after any mutation that
 * changes the folder/album set (create, rename, move, delete) so every consumer —
 * sidebar flyout, "Add to album", "Move to…" — stays in sync without each refetching.
 */
export function invalidateLibraryTree() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(INVALIDATE_EVENT));
}

/**
 * Fetches the folder + album tree once on mount (and on `invalidateLibraryTree()`)
 * and shares it via context, so the many album/folder pickers reuse one cached copy.
 */
export function LibraryTreeProvider({ children }: { children: React.ReactNode }) {
  const { slug } = useCatalog();
  const [folders, setFolders] = useState<FolderDTO[]>([]);
  const [albums, setAlbums] = useState<AlbumSummaryDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    fetch(catalogApiUrl(slug, "/library/tree"))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${r.url}`))))
      .then((data: { folders: FolderDTO[]; albums: AlbumSummaryDTO[] }) => {
        setFolders(data.folders);
        setAlbums(data.albums);
        setError(false);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
    const onInvalidate = () => reload();
    window.addEventListener(INVALIDATE_EVENT, onInvalidate);
    return () => window.removeEventListener(INVALIDATE_EVENT, onInvalidate);
  }, [reload]);

  return (
    <LibraryTreeContext.Provider value={{ folders, albums, loading, error, reload }}>
      {children}
    </LibraryTreeContext.Provider>
  );
}

export function useLibraryTree(): LibraryTree {
  const ctx = useContext(LibraryTreeContext);
  if (!ctx) throw new Error("useLibraryTree must be used within LibraryTreeProvider");
  return ctx;
}
