import { NextResponse } from "next/server";
import { downloadRequestSchema } from "@lumio/shared";
import { listPhotosForDownload } from "@/lib/server/photos-service";
import { originalPath } from "@/lib/server/server-paths";
import { streamPhotosZip } from "@/lib/server/download-archive";
import { parseJson } from "@/lib/server/route-helpers";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withCatalog(async (request, _context, { catalog }) => {
  const parsed = await parseJson(request, downloadRequestSchema);
  if ("response" in parsed) return parsed.response;
  const photos = await listPhotosForDownload(catalog.id, parsed.data.ids);
  if (photos.length === 0) {
    return NextResponse.json({ error: "No photos found" }, { status: 404 });
  }
  return streamPhotosZip(
    photos,
    `lumio-photos-${photos.length}${parsed.data.variant === "edited" ? "-edited" : ""}.zip`,
    parsed.data.variant,
    (relPath) => originalPath(catalog, relPath),
  );
});
