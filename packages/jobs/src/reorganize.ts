import { access, mkdir, readdir, rename, rmdir } from "node:fs/promises";
import path from "node:path";
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

async function exists(abs: string): Promise<boolean> {
  try {
    await access(abs);
    return true;
  } catch {
    return false;
  }
}

/** True if another Photo row or an on-disk file already occupies `relCandidate`. */
async function targetTaken(
  deps: Pick<ReorganizeDeps, "db" | "catalogId" | "photosDir">,
  relCandidate: string,
): Promise<boolean> {
  const row = await deps.db.photo.findUnique({
    where: { catalogId_path: { catalogId: deps.catalogId, path: relCandidate } },
    select: { id: true },
  });
  if (row) return true;
  return exists(path.join(deps.photosDir, relCandidate));
}

/** Resolve a collision-free catalog-relative target, suffixing "-1", "-2", … */
async function freeTarget(
  deps: Pick<ReorganizeDeps, "db" | "catalogId" | "photosDir">,
  desired: string,
): Promise<string> {
  const ext = path.posix.extname(desired);
  const stem = desired.slice(0, desired.length - ext.length);
  let candidate = desired;
  let n = 0;
  while (await targetTaken(deps, candidate)) {
    n += 1;
    candidate = `${stem}-${n}${ext}`;
  }
  return candidate;
}

/** Catalog-relative parent dir of a path ("" for root). */
function relDir(relPath: string): string {
  const dir = path.posix.dirname(relPath);
  return dir === "." ? "" : dir;
}

/** Remove directories left empty by the moves, bottom-up, never past photosDir. */
async function pruneEmptyDirs(vacated: Set<string>, photosDir: string): Promise<void> {
  const root = path.resolve(photosDir);
  for (const start of vacated) {
    let dir = path.resolve(start);
    while (dir !== root && dir.startsWith(root + path.sep)) {
      try {
        const entries = await readdir(dir);
        if (entries.length > 0) break;
        await rmdir(dir);
        dir = path.dirname(dir);
      } catch {
        break;
      }
    }
  }
}

/**
 * Danger zone: move every in-scope photo into the folder its upload template
 * produces. Per photo, the DB row's `path`/`dirPath` are updated BEFORE the file
 * is renamed, so the filesystem watcher's resulting unlink/add events are
 * no-ops (the row already matches the new path; the old path has no row). The
 * photo id, edits, and renditions (keyed by id) are preserved.
 */
export async function reorganizePhotos(
  deps: ReorganizeDeps,
): Promise<{ moved: number; skipped: number; failed: number }> {
  const rows = (await deps.db.photo.findMany({
    where: scopeWhere(deps.catalogId, deps.includeFilesystem),
    select: SCOPE_SELECT,
  })) as PhotoRow[];

  let moved = 0;
  let skipped = 0;
  let failed = 0;
  const vacated = new Set<string>();

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    const desired = desiredPath(deps.uploadTemplate, row);
    if (desired === row.path) {
      skipped += 1;
      await deps.onProgress?.(i + 1, rows.length);
      continue;
    }

    const fromAbs = path.join(deps.photosDir, row.path);
    if (!(await exists(fromAbs))) {
      failed += 1;
      deps.onWarn?.(`source file missing, skipped: ${row.path}`);
      await deps.onProgress?.(i + 1, rows.length);
      continue;
    }

    const target = await freeTarget(deps, desired);
    const toAbs = path.join(deps.photosDir, target);

    // DB first (watcher-safe).
    await deps.db.photo.update({
      where: { id: row.id },
      data: { path: target, dirPath: relDir(target) },
    });

    try {
      await mkdir(path.dirname(toAbs), { recursive: true });
      await rename(fromAbs, toAbs);
      vacated.add(path.dirname(fromAbs));
      moved += 1;
    } catch (err) {
      // Revert the repoint so the row keeps matching the still-in-place file.
      await deps.db.photo.update({
        where: { id: row.id },
        data: { path: row.path, dirPath: relDir(row.path) },
      });
      failed += 1;
      deps.onWarn?.(
        `move failed for ${row.path}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    await deps.onProgress?.(i + 1, rows.length);
  }

  await pruneEmptyDirs(vacated, deps.photosDir);
  return { moved, skipped, failed };
}
