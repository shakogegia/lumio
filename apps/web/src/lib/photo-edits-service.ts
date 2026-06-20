import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Prisma, prisma, toPhotoDTO } from "@lumio/db";
import { hasEdits, type PhotoDTO, type PhotoEdits } from "@lumio/shared";
import { buildRenditions, decodeToSharpInput } from "@lumio/ingest";
import { displayPath, originalPath, thumbnailPath } from "@/lib/paths";

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
    await mkdir(path.dirname(displayPath(id)), { recursive: true });
    await mkdir(path.dirname(thumbnailPath(id)), { recursive: true });
    await writeFile(displayPath(id), display);
    await writeFile(thumbnailPath(id), thumbnail);

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
