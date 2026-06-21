import type { ColorLabel } from "@lumio/shared";

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
  /** Real photo id from the API, set for added | duplicate. Enables selection
   * and the server thumbnail (`/api/thumbnails/<photoId>`). */
  photoId?: string;
  /** Optimistically-applied color label; tints the tile's card mat. */
  colorLabel?: ColorLabel | null;
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

/** From a batch's upload results, the photo ids to auto-add to a target album:
 * every upload that resolved to a real photo — newly stored (`added`) or an
 * existing library photo (`duplicate`). Errors and id-less results contribute
 * nothing. The album write is idempotent, so `duplicate` re-adds are no-ops. */
export function albumTargetIds(
  results: Array<{ status: RowStatus; photoId?: string }>,
): string[] {
  return results
    .filter((r) => (r.status === "added" || r.status === "duplicate") && r.photoId)
    .map((r) => r.photoId as string);
}
