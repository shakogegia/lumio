import { Prisma, type PrismaClient, prisma, toPhotoDTO } from "@lumio/db";
import { EDITS_VERSION, hasEdits, wbBaselineOf, type PhotoDTO, type PhotoEdits } from "@lumio/shared";
import { regenerateRenditions } from "@lumio/ingest";
import { catalogCacheDirs, originalPath } from "@/lib/server/server-paths";

type Db = Pick<PrismaClient, "photo">;

/**
 * Apply a photo's edit recipe and persist it. Passing `null` (or the identity
 * recipe) resets the photo to its original. Returns the updated DTO, or null if the
 * photo doesn't exist in the given catalog.
 *
 * `@lumio/ingest`'s regenerateRenditions is the single owner of rendition writes —
 * it (re)writes the edit-free base display, the thumbnail, and the baked edited
 * display (removing the edited variant on reset) and returns the stored
 * dims/thumbhash. Renditions are written before the DB update: if the update fails,
 * the on-disk files are ahead of Photo.edits/updatedAt, so the unchanged cache-bust
 * token keeps clients on the old URL until a later successful apply — rare,
 * self-heals on retry.
 *
 * `catalog` must carry `id` (DB scoping + cache paths) and `path` (the catalog root
 * on disk, for resolving the original via originalPath).
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
  const { thumbhash, width, height } = await regenerateRenditions(
    originalPath(catalog, photo.path),
    recipe,
    id,
    catalogCacheDirs(catalog.id),
    wbBaselineOf(photo),
  );

  const updated = await db.photo.update({
    where: { id, catalogId: catalog.id },
    // Prisma needs the JsonNull sentinel (not JS null) to clear a Json column.
    // Always stamp the current schema version so stored recipes are never
    // re-migrated as legacy on read (coercePhotoEdits skips version >= current).
    data: {
      edits: recipe
        ? ({ ...recipe, version: EDITS_VERSION } as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      width,
      height,
      thumbhash,
    },
  });
  return toPhotoDTO(updated);
}
