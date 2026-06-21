import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Prisma, prisma, toPhotoDTO } from "@lumio/db";
import { hasEdits, type PhotoDTO, type PhotoEdits } from "@lumio/shared";
import { buildRenditions, decodeToSharpInput } from "@lumio/ingest";
import { editedDisplayPath, originalPath, thumbnailPath } from "@/lib/paths";

/**
 * Regenerate a photo's renditions for the given edit recipe and persist it.
 * Passing `null` (or the identity recipe) resets the photo to its original.
 * Returns the updated DTO, or null if the photo doesn't exist.
 */
export async function applyPhotoEdits(
  id: string,
  edits: PhotoEdits | null,
): Promise<PhotoDTO | null> {
  const photo = await prisma.photo.findUnique({ where: { id } });
  if (!photo) return null;

  const recipe = hasEdits(edits) ? edits : null;
  const decoded = await decodeToSharpInput(originalPath(photo.path));
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
    await mkdir(path.dirname(thumbnailPath(id)), { recursive: true });
    await writeFile(thumbnailPath(id), thumbnail);
    if (recipe) {
      await mkdir(path.dirname(editedDisplayPath(id)), { recursive: true });
      await writeFile(editedDisplayPath(id), display); // baked, separate from the base
    } else {
      await rm(editedDisplayPath(id), { force: true }); // reset → drop the edited variant
    }

    const updated = await prisma.photo.update({
      where: { id },
      // Prisma needs the JsonNull sentinel (not JS null) to clear a Json column.
      data: { edits: recipe ? (recipe as unknown as Prisma.InputJsonValue) : Prisma.JsonNull, width, height, thumbhash },
    });
    return toPhotoDTO(updated);
  } finally {
    await decoded.cleanup();
  }
}
