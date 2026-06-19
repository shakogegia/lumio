"use client";

import { ALBUM_COLUMNS_STORAGE_KEY } from "@/lib/grid-layout";
import { makeColumnsStore } from "@/lib/columns-store";

/**
 * Persisted album-card density (columns per row) for the /albums listing.
 * Independent from the photo-grid density: its own localStorage key and no
 * `--grid-columns` CSS-var side-effect (albums are server-rendered — no
 * skeleton to keep in sync).
 */
export const useAlbumColumns = makeColumnsStore({
  storageKey: ALBUM_COLUMNS_STORAGE_KEY,
  syncCssVar: false,
});
