"use client";

import { FOLDERS_COLUMNS_STORAGE_KEY, FOLDERS_DEFAULT_COLUMNS } from "@/lib/grid-layout";
import { makeColumnsStore } from "@/lib/columns-store";

/**
 * Persisted folder/file grid density (columns per row) for the disk explorer.
 * Independent of the photo and album grids (its own storage key); no pre-paint
 * CSS variable — the explorer applies the column count via inline style.
 */
export const useFolderColumns = makeColumnsStore({
  storageKey: FOLDERS_COLUMNS_STORAGE_KEY,
  cssVar: null,
  defaultColumns: FOLDERS_DEFAULT_COLUMNS,
});
