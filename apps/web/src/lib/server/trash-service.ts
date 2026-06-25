import { existsSync } from "node:fs";
import { copyFile, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { type PrismaClient, prisma, toPhotoDTO, toTrashedPhotoDTO } from "@lumio/db";
import { parentDir, type PhotosPage, type PhotosQuery } from "@lumio/shared";

type Db = Pick<PrismaClient, "photo" | "trashedPhoto" | "album">;

export interface TrashDeps {
  db: Db;
  catalogId: string;
  /** Absolute path to the catalog's originals directory (catalog.path). */
  photosDir: string;
  /** Absolute path to the per-catalog cache dir (e.g. CACHE_DIR/<catalogId>). */
  cacheDir: string;
  /** Absolute path to the per-catalog trash dir (e.g. TRASH_DIR/<catalogId>). */
  trashDir: string;
}

/** Move a file, tolerating a missing source and cross-device renames. */
async function moveFile(from: string, to: string): Promise<void> {
  await mkdir(path.dirname(to), { recursive: true });
  try {
    await rename(from, to);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return; // best-effort: nothing to move
    if (code === "EXDEV") {
      await copyFile(from, to);
      await rm(from, { force: true });
      return;
    }
    throw err;
  }
}

/** A path under photosDir that's free; appends " (restored)" suffixes if taken. */
function freePath(photosDir: string, relPath: string): string {
  if (!existsSync(path.join(photosDir, relPath))) return relPath;
  const dir = path.dirname(relPath);
  const ext = path.extname(relPath);
  const base = path.basename(relPath, ext);
  for (let i = 1; ; i++) {
    const suffix = i === 1 ? " (restored)" : ` (restored ${i})`;
    const candidate = path.join(dir, `${base}${suffix}${ext}`);
    if (!existsSync(path.join(photosDir, candidate))) return candidate;
  }
}

async function existingAlbumIds(db: Db, catalogId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db.album.findMany({
    where: { catalogId, id: { in: ids } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function listTrash(
  catalogId: string,
  params: PhotosQuery,
  db: Pick<PrismaClient, "photo" | "trashedPhoto"> = prisma,
): Promise<PhotosPage> {
  const { limit, offset } = params;
  const window = offset + limit; // most rows this page could need from either source
  const [pending, trashed, pendingCount, trashedCount] = await Promise.all([
    db.photo.findMany({
      where: { catalogId, trashedAt: { not: null } },
      take: window,
      orderBy: [{ trashedAt: "desc" }, { id: "desc" }],
    }),
    db.trashedPhoto.findMany({
      where: { catalogId },
      take: window,
      orderBy: [{ deletedAt: "desc" }, { id: "desc" }],
    }),
    db.photo.count({ where: { catalogId, trashedAt: { not: null } } }),
    db.trashedPhoto.count({ where: { catalogId } }),
  ]);

  // Merge into one newest-trash-first stream. A photo mid-finalize can briefly
  // exist in BOTH tables (same id) — dedupe, preferring the pending Photo row.
  const seen = new Set<string>();
  const merged = [
    ...pending.map((p) => ({ id: p.id, at: p.trashedAt as Date, dto: toPhotoDTO(p) })),
    ...trashed.map((t) => ({ id: t.id, at: t.deletedAt, dto: toTrashedPhotoDTO(t) })),
  ]
    .sort((a, b) => (b.at.getTime() - a.at.getTime()) || (a.id < b.id ? 1 : -1))
    .filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true)));

  const items = merged.slice(offset, offset + limit).map((r) => r.dto);
  return { items, total: pendingCount + trashedCount };
}

export async function restorePhotos(
  ids: string[],
  deps: TrashDeps,
): Promise<{ restored: number }> {
  let restored = 0;
  for (const id of ids) {
    const t = await deps.db.trashedPhoto.findFirst({
      where: { id, catalogId: deps.catalogId },
    });
    if (!t) continue;

    const destRel = freePath(deps.photosDir, t.originalPath);
    const albumIds = await existingAlbumIds(deps.db, deps.catalogId, t.albumIds);

    // The trashed original is still in place here; stat it for the NOT NULL
    // file-stat columns. If it's somehow gone, fall back to the snapshot's
    // sortDate (and 0 bytes) — the watcher's re-ingest and the next scan
    // re-stamp from the real file once it lands.
    const ext = path.extname(t.originalPath);
    const trashOriginal = path.join(deps.trashDir, "originals", `${id}${ext}`);
    const st = await stat(trashOriginal).catch(() => null);
    const fileMtimeMs = st?.mtimeMs ?? t.sortDate.getTime();
    const fileBirthtimeMs = st?.birthtimeMs ?? t.sortDate.getTime();

    // 1. Recreate the row (same id) BEFORE the file lands, so the watcher's
    //    `add` upserts in place (keeps id + album links) instead of recreating.
    //    Reuses the trashed id, which is safe because a trashed photo's row was
    //    deleted on trash, so no live Photo can hold this id.
    await deps.db.photo.create({
      data: {
        id: t.id,
        catalogId: deps.catalogId,
        path: destRel,
        dirPath: parentDir(destRel),
        source: t.source,
        takenAt: t.takenAt,
        sortDate: t.sortDate,
        width: t.width,
        height: t.height,
        hash: t.hash,
        thumbhash: t.thumbhash,
        exif: t.exif as object,
        colorLabel: t.colorLabel,
        fileSize: st?.size ?? 0,
        fileMtimeMs,
        fileModifiedAt: new Date(fileMtimeMs),
        fileCreatedAt: new Date(fileBirthtimeMs),
        albums: { create: albumIds.map((albumId) => ({ albumId })) },
      },
    });

    // 2. Move renditions + original back.
    await moveFile(
      path.join(deps.trashDir, "thumbnails", `${id}.webp`),
      path.join(deps.cacheDir, "thumbnails", `${id}.webp`),
    );
    await moveFile(
      path.join(deps.trashDir, "displays", `${id}.webp`),
      path.join(deps.cacheDir, "displays", `${id}.webp`),
    );
    await moveFile(
      path.join(deps.trashDir, "originals", `${id}${ext}`),
      path.join(deps.photosDir, destRel),
    );

    // 3. Drop the trash record.
    await deps.db.trashedPhoto.deleteMany({ where: { id, catalogId: deps.catalogId } });
    restored++;
  }
  return { restored };
}
