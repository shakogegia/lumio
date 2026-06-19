/** A single file's lifecycle in the uploader. `unsupported` files are NOT rows —
 * they're counted separately so a dropped folder of junk can't flood the grid. */
export type RowStatus = "queued" | "uploading" | "added" | "duplicate" | "error";

export interface Row {
  /** Client-side row id (monotonic counter). */
  id: number;
  /** Retained so a failed upload can be retried. */
  file: File;
  name: string;
  status: RowStatus;
  message?: string;
  /** Real photo id from the API, set for added | duplicate. Enables selection. */
  photoId?: string;
  /** Object URL for previewable formats; revoked on removal/unmount. */
  previewUrl?: string;
}

export interface RowSummary {
  total: number;
  /** added + duplicate + error. */
  done: number;
  /** queued + uploading (still in flight). */
  uploading: number;
  added: number;
  duplicate: number;
  error: number;
}

export function summarizeRows(rows: Row[]): RowSummary {
  let added = 0;
  let duplicate = 0;
  let error = 0;
  let pending = 0;
  for (const r of rows) {
    if (r.status === "added") added++;
    else if (r.status === "duplicate") duplicate++;
    else if (r.status === "error") error++;
    else pending++; // queued | uploading
  }
  return {
    total: rows.length,
    done: added + duplicate + error,
    uploading: pending,
    added,
    duplicate,
    error,
  };
}

/** Photo ids of rows that can be selected/organized (those that have one). */
export function selectableIds(rows: Row[]): string[] {
  return rows.filter((r) => r.photoId).map((r) => r.photoId as string);
}

/** A new Set with `id` toggled (added if absent, removed if present). Used as a
 * functional state updater so the toggle handler stays referentially stable
 * (no dependency on the current selection), which keeps memoized tiles from
 * re-rendering when an unrelated tile is selected. */
export function toggleId(ids: Set<string>, id: string): Set<string> {
  const next = new Set(ids);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
