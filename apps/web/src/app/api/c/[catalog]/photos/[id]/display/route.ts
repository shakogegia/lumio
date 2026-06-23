import { readFile } from "node:fs/promises";
import { displayPath, editedDisplayPath } from "@/lib/server/server-paths";
import { withCatalog } from "@/lib/server/with-catalog";
import { binaryResponse, errorJson } from "@/lib/server/route-helpers";
import { photoExistsInCatalog } from "@/lib/server/photos-service";

export const runtime = "nodejs";

export const GET = withCatalog<{ id: string }>(async (request, context, { catalog }) => {
  const { id } = await context.params;
  const owned = await photoExistsInCatalog(catalog.id, id);
  if (!owned) return errorJson("Not found", 404);

  const base = new URL(request.url).searchParams.get("base");
  try {
    if (!base) {
      // Default: the current image — edited variant if present, else the base.
      try {
        return binaryResponse(await readFile(editedDisplayPath(catalog.id, id)), { contentType: "image/webp" });
      } catch {
        // no edited variant → fall through to the base
      }
    }
    return binaryResponse(await readFile(displayPath(catalog.id, id)), { contentType: "image/webp" });
  } catch {
    return errorJson("Display rendition not found", 404);
  }
});
