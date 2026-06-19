import { existsSync } from "node:fs";
import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { type PrismaClient, prisma, toTrashedPhotoDTO } from "@lumio/db";
import type { PhotosPage, PhotosQuery } from "@lumio/shared";
import { CACHE_DIR, PHOTOS_DIR, TRASH_DIR } from "@/lib/paths";

type Db = Pick<PrismaClient, "photo" | "trashedPhoto" | "album">;

export interface TrashDeps {
  db: Db;
  photosDir: string;
  cacheDir: string;
  trashDir: string;
}

const defaultDeps: TrashDeps = {
  db: prisma,
  photosDir: PHOTOS_DIR,
  cacheDir: CACHE_DIR,
  trashDir: TRASH_DIR,
};

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

async function existingAlbumIds(db: Db, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db.album.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function trashPhotos(
  ids: string[],
  deps: TrashDeps = defaultDeps,
): Promise<{ trashed: number }> {
  let trashed = 0;
  for (const id of ids) {
    const photo = await deps.db.photo.findUnique({
      where: { id },
      include: { albums: { select: { albumId: true } } },
    });
    if (!photo) continue;

    // 1. Snapshot BEFORE any row deletion so no race can lose the metadata.
    await deps.db.trashedPhoto.create({
      data: {
        id: photo.id,
        originalPath: photo.path,
        source: photo.source,
        takenAt: photo.takenAt,
        sortDate: photo.sortDate,
        width: photo.width,
        height: photo.height,
        hash: photo.hash,
        exif: photo.exif as object,
        colorLabel: photo.colorLabel,
        albumIds: photo.albums.map((a) => a.albumId),
      },
    });

    // 2. Move renditions + original into the trash.
    const ext = path.extname(photo.path);
    await moveFile(
      path.join(deps.cacheDir, "thumbnails", `${id}.webp`),
      path.join(deps.trashDir, "thumbnails", `${id}.webp`),
    );
    await moveFile(
      path.join(deps.cacheDir, "displays", `${id}.webp`),
      path.join(deps.trashDir, "displays", `${id}.webp`),
    );
    await moveFile(
      path.join(deps.photosDir, photo.path),
      path.join(deps.trashDir, "originals", `${id}${ext}`),
    );

    // 3. Delete the Photo row. deleteMany is tolerant of "already gone" — the
    //    watcher's unlink (fired by step 2) may delete it first; same end state.
    await deps.db.photo.deleteMany({ where: { id } });
    trashed++;
  }
  return { trashed };
}

export async function listTrash(
  params: PhotosQuery,
  db: Db = prisma,
): Promise<PhotosPage> {
  const { limit, cursor } = params;
  const rows = await db.trashedPhoto.findMany({
    take: limit,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    orderBy: [{ deletedAt: "desc" }, { id: "desc" }],
  });
  const nextCursor =
    rows.length === limit ? (rows[rows.length - 1]?.id ?? null) : null;
  return { items: rows.map(toTrashedPhotoDTO), nextCursor };
}

export async function restorePhotos(
  ids: string[],
  deps: TrashDeps = defaultDeps,
): Promise<{ restored: number }> {
  let restored = 0;
  for (const id of ids) {
    const t = await deps.db.trashedPhoto.findUnique({ where: { id } });
    if (!t) continue;

    const destRel = freePath(deps.photosDir, t.originalPath);
    const albumIds = await existingAlbumIds(deps.db, t.albumIds);

    // 1. Recreate the row (same id) BEFORE the file lands, so the watcher's
    //    `add` upserts in place (keeps id + album links) instead of recreating.
    //    Reuses the trashed id, which is safe because a trashed photo's row was
    //    deleted on trash, so no live Photo can hold this id.
    await deps.db.photo.create({
      data: {
        id: t.id,
        path: destRel,
        source: t.source,
        takenAt: t.takenAt,
        sortDate: t.sortDate,
        width: t.width,
        height: t.height,
        hash: t.hash,
        exif: t.exif as object,
        colorLabel: t.colorLabel,
        albums: { create: albumIds.map((albumId) => ({ albumId })) },
      },
    });

    // 2. Move renditions + original back.
    const ext = path.extname(t.originalPath);
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
    await deps.db.trashedPhoto.delete({ where: { id } });
    restored++;
  }
  return { restored };
}

export async function purgeTrash(
  ids: string[] | undefined,
  deps: TrashDeps = defaultDeps,
): Promise<{ deleted: number }> {
  const where = ids ? { id: { in: ids } } : {};
  const rows = await deps.db.trashedPhoto.findMany({
    where,
    select: { id: true, originalPath: true },
  });
  await Promise.all(
    rows.flatMap((r) => {
      const ext = path.extname(r.originalPath);
      return [
        rm(path.join(deps.trashDir, "originals", `${r.id}${ext}`), { force: true }),
        rm(path.join(deps.trashDir, "thumbnails", `${r.id}.webp`), { force: true }),
        rm(path.join(deps.trashDir, "displays", `${r.id}.webp`), { force: true }),
      ];
    }),
  );
  const { count } = await deps.db.trashedPhoto.deleteMany({ where });
  return { deleted: count };
}
