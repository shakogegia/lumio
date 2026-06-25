import { withShare } from "@/lib/server/with-share";
import { originalPath } from "@/lib/server/server-paths";
import { sanitizeZipName, streamPhotosZip } from "@/lib/server/download-archive";
import { listShareLinkPhotosForDownload } from "@/lib/server/share-links-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withShare(async (_request, _context, { shareLink, catalog }) => {
  const photos = await listShareLinkPhotosForDownload(catalog.id, shareLink.id);
  const name = `${sanitizeZipName(shareLink.title ?? "shared-photos")}.zip`;
  return streamPhotosZip(photos, name, "edited", (relPath) => originalPath(catalog, relPath));
});
