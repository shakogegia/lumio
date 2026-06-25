import { photoIdsSchema } from "@lumio/shared";
import { withShare } from "@/lib/server/with-share";
import { parseJson } from "@/lib/server/route-helpers";
import { originalPath } from "@/lib/server/server-paths";
import { sanitizeZipName, streamPhotosZip } from "@/lib/server/download-archive";
import { listShareLinkPhotosForDownloadSubset } from "@/lib/server/share-links-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withShare(async (request, _context, { shareLink, catalog }) => {
  const parsed = await parseJson(request, photoIdsSchema);
  if ("response" in parsed) return parsed.response;
  const photos = await listShareLinkPhotosForDownloadSubset(catalog.id, shareLink.id, parsed.data.ids);
  const name = `${sanitizeZipName(shareLink.title ?? "shared-photos")}.zip`;
  return streamPhotosZip(photos, name, "edited", (relPath) => originalPath(catalog, relPath));
});
