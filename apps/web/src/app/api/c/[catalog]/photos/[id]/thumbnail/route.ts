import { readFile } from "node:fs/promises";
import { thumbnailPath, trashThumbnailPath } from "@/lib/server/server-paths";
import { withCatalog } from "@/lib/server/with-catalog";
import { binaryResponse, errorJson } from "@/lib/server/route-helpers";
import { photoOrTrashedExistsInCatalog } from "@/lib/server/photos-service";

export const runtime = "nodejs";

export const GET = withCatalog<{ id: string }>(async (_request, context, { catalog }) => {
  const { id } = await context.params;
  // Verify ownership: photo or trashed photo must belong to this catalog.
  const owned = await photoOrTrashedExistsInCatalog(catalog.id, id);
  if (!owned) return errorJson("Not found", 404);

  try {
    return binaryResponse(await readFile(thumbnailPath(catalog.id, id)), { contentType: "image/webp" });
  } catch {
    // Trashed photos keep their thumbnail under TRASH_DIR so the Trash grid
    // can render via the same URL.
    try {
      return binaryResponse(await readFile(trashThumbnailPath(catalog.id, id)), { contentType: "image/webp" });
    } catch {
      return errorJson("Thumbnail not found", 404);
    }
  }
});
