"use client";

import { useCallback, useState } from "react";
import { parseColumns } from "@/lib/columns-store";
import { FOLDERS_DEFAULT_COLUMNS } from "@/lib/grid-layout";
import type { FolderSort } from "@/lib/catalog-fs";

export type FolderViewMode = "grid" | "list";

/** Cookie (not localStorage) so the server can render the chosen layout on the
 *  first paint — no hydration flicker of the toolbar/grid. */
export const FOLDER_PREFS_COOKIE = "lumio.folderPrefs";

export interface FolderPrefs {
  view: FolderViewMode;
  columns: number;
  sort: FolderSort;
}

export const DEFAULT_FOLDER_PREFS: FolderPrefs = {
  view: "grid",
  columns: FOLDERS_DEFAULT_COLUMNS,
  sort: { field: "name", dir: "asc" },
};

/** Parse the folder-prefs cookie value (URL-encoded flat JSON), falling back
 *  per-field to the defaults. Pure; tolerates encoded or already-decoded input. */
export function parseFolderPrefs(raw: string | undefined | null): FolderPrefs {
  if (!raw) return DEFAULT_FOLDER_PREFS;
  let text = raw;
  try {
    text = decodeURIComponent(raw);
  } catch {
    text = raw;
  }
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return DEFAULT_FOLDER_PREFS;
  }
  if (typeof obj !== "object" || obj === null) return DEFAULT_FOLDER_PREFS;
  const o = obj as Record<string, unknown>;
  return {
    view: o.view === "list" ? "list" : "grid",
    columns: parseColumns(
      typeof o.columns === "number" ? String(o.columns) : null,
      FOLDERS_DEFAULT_COLUMNS,
    ),
    sort: {
      field: o.sortField === "date" ? "date" : "name",
      dir: o.sortDir === "desc" ? "desc" : "asc",
    },
  };
}

/** Serialize prefs to the flat JSON stored in the cookie. Pure. */
export function serializeFolderPrefs(p: FolderPrefs): string {
  return JSON.stringify({
    view: p.view,
    columns: p.columns,
    sortField: p.sort.field,
    sortDir: p.sort.dir,
  });
}

/**
 * Folder-explorer prefs seeded from the server (cookie) so first paint matches
 * the user's choice. Writes persist back to the cookie (1 year) so later SSR
 * renders stay correct.
 */
export function useFolderPrefs(initial: FolderPrefs) {
  const [prefs, setPrefs] = useState(initial);
  const update = useCallback((patch: Partial<FolderPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      document.cookie = `${FOLDER_PREFS_COOKIE}=${encodeURIComponent(
        serializeFolderPrefs(next),
      )}; path=/; max-age=31536000; samesite=lax`;
      return next;
    });
  }, []);
  return { prefs, update };
}
