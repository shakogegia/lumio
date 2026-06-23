"use client";

import { ALBUM_COLUMNS_STORAGE_KEY, ALBUM_DEFAULT_COLUMNS } from "@/lib/grid-layout";
import { makeColumnsStore } from "@/lib/columns-store";

/**
 * Persisted album-card density (columns per row) for the /albums listing.
 * Independent from the photo-grid density: its own localStorage key and its own
 * `--album-columns` CSS variable. The server-rendered album grid reads that
 * variable (set by the root-layout pre-paint script) so it paints at the chosen
 * density on the first frame instead of flashing the default before hydration.
 */
export const useAlbumColumns = makeColumnsStore({
  storageKey: ALBUM_COLUMNS_STORAGE_KEY,
  cssVar: "--album-columns",
  defaultColumns: ALBUM_DEFAULT_COLUMNS,
});
