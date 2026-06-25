import { readFile } from "node:fs/promises";
import { displayPath, editedDisplayPath } from "@/lib/server/server-paths";
import { withShare } from "@/lib/server/with-share";
import { binaryResponse, errorJson } from "@/lib/server/route-helpers";
import { shareLinkPhotoExists } from "@/lib/server/share-links-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public viewers always get the edited rendition (edits baked in). Deliberately
// NO `?base=1` support (unlike the authed route) — exposing the un-edited base
// over a public link would defeat the point of baking edits in.
export const GET = withShare<{ id: string }>(async (_request, context, { shareLink, catalog }) => {
  const { id } = await context.params;
  if (!(await shareLinkPhotoExists(shareLink.id, id))) return errorJson("Not found", 404);
  try {
    try {
      return binaryResponse(await readFile(editedDisplayPath(catalog.id, id)), {
        contentType: "image/webp",
        cacheControl: "private, max-age=300",
      });
    } catch {
      // no edited variant → fall through to the base
    }
    return binaryResponse(await readFile(displayPath(catalog.id, id)), {
      contentType: "image/webp",
      cacheControl: "private, max-age=300",
    });
  } catch {
    return errorJson("Display rendition not found", 404);
  }
});
