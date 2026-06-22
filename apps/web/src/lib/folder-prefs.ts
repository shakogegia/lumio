import { COLUMNS_MAX, COLUMNS_MIN, FOLDERS_DEFAULT_COLUMNS } from "@/lib/grid-layout";
import type { FolderSort } from "@/lib/catalog-fs";

// Pure (no "use client"): the server page reads + parses the cookie, and the
// client hook (use-folder-prefs.ts) reuses these helpers. Keep it dependency-free
// of client-only modules so it stays callable from Server Components.

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

function clampColumns(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return FOLDERS_DEFAULT_COLUMNS;
  return Math.min(COLUMNS_MAX, Math.max(COLUMNS_MIN, Math.round(value)));
}

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
    columns: clampColumns(o.columns),
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
