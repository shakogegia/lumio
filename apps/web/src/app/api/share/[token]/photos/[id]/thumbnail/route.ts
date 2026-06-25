import { readFile } from "node:fs/promises";
import { thumbnailPath } from "@/lib/server/server-paths";
import { withShare } from "@/lib/server/with-share";
import { binaryResponse, errorJson } from "@/lib/server/route-helpers";
import { shareLinkPhotoExists } from "@/lib/server/share-links-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withShare<{ id: string }>(async (_request, context, { shareLink, catalog }) => {
  const { id } = await context.params;
  if (!(await shareLinkPhotoExists(shareLink.id, id))) return errorJson("Not found", 404);
  try {
    return binaryResponse(await readFile(thumbnailPath(catalog.id, id)), {
      contentType: "image/webp",
      cacheControl: "private, max-age=300",
    });
  } catch {
    return errorJson("Thumbnail not found", 404);
  }
});
