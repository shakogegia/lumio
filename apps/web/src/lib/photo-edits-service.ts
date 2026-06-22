import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Prisma, type PrismaClient, prisma, toPhotoDTO } from "@lumio/db";
import { hasEdits, type PhotoDTO, type PhotoEdits } from "@lumio/shared";
import { buildRenditions, decodeToSharpInput } from "@lumio/ingest";
import { editedDisplayPath, originalPath, thumbnailPath } from "@/lib/paths";

type Db = Pick<PrismaClient, "photo">;

/**
 * Regenerate a photo's renditions for the given edit recipe and persist it.
 * Passing `null` (or the identity recipe) resets the photo to its original.
 * Returns the updated DTO, or null if the photo doesn't exist in the given catalog.
 *
 * `catalog` must carry both `id` (for DB scoping and cache paths) and `path`
 * (the catalog's root on disk, for resolving the original file via `originalPath`).
 */
export async function applyPhotoEdits(
  catalog: { id: string; path: string },
  id: string,
  edits: PhotoEdits | null,
  db: Db = prisma,
): Promise<PhotoDTO | null> {
  const photo = await db.photo.findFirst({ where: { id, catalogId: catalog.id } });
  if (!photo) return null;

  const recipe = hasEdits(edits) ? edits : null;
  const decoded = await decodeToSharpInput(originalPath(catalog, photo.path));
  try {
    const { display, thumbnail, thumbhash, width, height } = await buildRenditions(
      decoded.input,
      recipe,
    );
    // Renditions are written before the DB update. If the update fails, the
    // on-disk renditions (thumb + edited file) reflect the new edit but
    // Photo.edits/updatedAt stay old, so the cache-bust token is unchanged and
    // clients keep serving the cached (old) URL — the new renditions are
    // effectively ignored until a later successful apply overwrites them.
    // Acceptable: rare, self-heals on retry.
    //
    // The base display (displayPath) is written once at ingest and stays edit-free
    // — never rewritten here. The thumbnail is always the current state.
    await mkdir(path.dirname(thumbnailPath(catalog.id, id)), { recursive: true });
    await writeFile(thumbnailPath(catalog.id, id), thumbnail);
    if (recipe) {
      await mkdir(path.dirname(editedDisplayPath(catalog.id, id)), { recursive: true });
      await writeFile(editedDisplayPath(catalog.id, id), display); // baked, separate from the base
    } else {
      await rm(editedDisplayPath(catalog.id, id), { force: true }); // reset → drop the edited variant
    }

    const updated = await db.photo.update({
      where: { id },
      // Prisma needs the JsonNull sentinel (not JS null) to clear a Json column.
      data: { edits: recipe ? (recipe as unknown as Prisma.InputJsonValue) : Prisma.JsonNull, width, height, thumbhash },
    });
    return toPhotoDTO(updated);
  } finally {
    await decoded.cleanup();
  }
}
