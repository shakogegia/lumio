import type { PrismaClient } from "@lumio/db";
import { renderTemplate } from "@lumio/shared";

export interface ReorganizeDeps {
  db: Pick<PrismaClient, "photo">;
  catalogId: string;
  photosDir: string;
  uploadTemplate: string;
  includeFilesystem: boolean;
  onProgress?: (processed: number, total: number) => void | Promise<void>;
  /** Diagnostic sink for per-photo anomalies (missing file, rename failure). */
  onWarn?: (message: string) => void;
}

interface PhotoRow {
  id: string;
  path: string;
  takenAt: Date | null;
  fileModifiedAt: Date;
  fileCreatedAt: Date;
  createdAt: Date;
}

const SCOPE_SELECT = {
  id: true,
  path: true,
  takenAt: true,
  fileModifiedAt: true,
  fileCreatedAt: true,
  createdAt: true,
} as const;

/** WHERE clause for the photos a reorg considers: non-trashed, optionally upload-only. */
function scopeWhere(catalogId: string, includeFilesystem: boolean) {
  return {
    catalogId,
    trashedAt: null,
    ...(includeFilesystem ? {} : { source: "upload" as const }),
  };
}

/** The catalog-relative path the template produces for one photo. */
export function desiredPath(uploadTemplate: string, row: PhotoRow): string {
  const date = row.takenAt ?? row.fileModifiedAt ?? row.fileCreatedAt;
  return renderTemplate(uploadTemplate, {
    date,
    now: row.createdAt,
    originalFilename: row.path.split("/").pop() ?? row.path,
  });
}

/** Count how many in-scope photos are not already at their template path. */
export async function previewReorganize(
  deps: Pick<ReorganizeDeps, "db" | "catalogId" | "uploadTemplate" | "includeFilesystem">,
): Promise<{ total: number; willMove: number }> {
  const rows = (await deps.db.photo.findMany({
    where: scopeWhere(deps.catalogId, deps.includeFilesystem),
    select: SCOPE_SELECT,
  })) as PhotoRow[];
  let willMove = 0;
  for (const r of rows) {
    if (desiredPath(deps.uploadTemplate, r) !== r.path) willMove += 1;
  }
  return { total: rows.length, willMove };
}
