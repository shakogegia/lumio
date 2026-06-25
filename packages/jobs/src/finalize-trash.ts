import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@lumio/db";

type Db = Pick<PrismaClient, "photo" | "trashedPhoto">;

export interface FinalizeTrashDeps {
  db: Db;
  catalogId: string;
  /** Catalog originals dir (catalog.path). */
  photosDir: string;
  /** Per-catalog cache dir (CACHE_DIR/<catalogId>). */
  cacheDir: string;
  /** Per-catalog trash dir (TRASH_DIR/<catalogId>). */
  trashDir: string;
  /** Injectable for tests; defaults to the real move. */
  moveFile?: (from: string, to: string) => Promise<void>;
}

/** Move a file, tolerating a missing source and cross-device renames. */
async function realMoveFile(from: string, to: string): Promise<void> {
  await mkdir(path.dirname(to), { recursive: true });
  try {
    await rename(from, to);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
    if (code === "EXDEV") {
      await copyFile(from, to);
      await rm(from, { force: true });
      return;
    }
    throw err;
  }
}

/**
 * Drain pending-trash photos (Photo.trashedAt IS NOT NULL) for one catalog:
 * snapshot to TrashedPhoto, move renditions + original into the trash, delete the
 * Photo row. Loops one-at-a-time re-querying the oldest still-pending row, so a
 * photo marked WHILE this job runs is still picked up (the enqueue dedups against
 * the running job), and a photo un-trashed via Undo is simply never seen again.
 */
export async function finalizeTrash(
  deps: FinalizeTrashDeps,
  onProgress?: (done: number) => void,
): Promise<{ finalized: number }> {
  const move = deps.moveFile ?? realMoveFile;
  let finalized = 0;
  for (;;) {
    const photo = await deps.db.photo.findFirst({
      where: { catalogId: deps.catalogId, trashedAt: { not: null } },
      orderBy: { trashedAt: "asc" },
      include: { albums: { select: { albumId: true } } },
    });
    if (!photo) break;

    // 1. Snapshot BEFORE any deletion so no race loses the metadata. Upsert
    //    (not create) so the loop is idempotent: a crash AFTER this snapshot but
    //    BEFORE deleteMany leaves the Photo row still pending, and the next drain
    //    re-finds it — the no-op `update` keeps the prior snapshot instead of
    //    throwing P2002 (duplicate id) and wedging the photo forever.
    await deps.db.trashedPhoto.upsert({
      where: { id: photo.id },
      create: {
        id: photo.id,
        catalogId: deps.catalogId,
        originalPath: photo.path,
        source: photo.source,
        takenAt: photo.takenAt,
        sortDate: photo.sortDate,
        width: photo.width,
        height: photo.height,
        hash: photo.hash,
        thumbhash: photo.thumbhash,
        exif: photo.exif as object,
        colorLabel: photo.colorLabel,
        albumIds: photo.albums.map((a) => a.albumId),
      },
      update: {}, // snapshot already taken on a prior (crashed) attempt — keep it
    });

    // 2. Move renditions + original into the trash.
    const id = photo.id;
    const ext = path.extname(photo.path);
    await move(path.join(deps.cacheDir, "thumbnails", `${id}.webp`), path.join(deps.trashDir, "thumbnails", `${id}.webp`));
    await move(path.join(deps.cacheDir, "displays", `${id}.webp`), path.join(deps.trashDir, "displays", `${id}.webp`));
    await move(path.join(deps.photosDir, photo.path), path.join(deps.trashDir, "originals", `${id}${ext}`));

    // 3. Delete the Photo row (tolerant: the watcher's unlink may delete it first).
    await deps.db.photo.deleteMany({ where: { id, catalogId: deps.catalogId } });
    finalized++;
    onProgress?.(finalized);
  }
  return { finalized };
}
