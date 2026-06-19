"use client";

import { GRID_COLUMNS_STORAGE_KEY } from "@/lib/grid-layout";
import { makeColumnsStore, parseColumns } from "@/lib/columns-store";

// Back-compat re-export: existing callers and use-grid-columns.test.ts import
// parseGridColumns from here.
export const parseGridColumns = parseColumns;

/**
 * Global, persisted grid density as a column count (photos per row). Persisted
 * to localStorage so the choice carries across routes and reloads, and synced
 * across tabs via the `storage` event. Drives the `--grid-columns` CSS variable
 * read by the root-layout pre-paint script.
 */
export const useGridColumns = makeColumnsStore({
  storageKey: GRID_COLUMNS_STORAGE_KEY,
  syncCssVar: true,
});
