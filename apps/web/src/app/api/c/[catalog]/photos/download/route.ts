import { NextResponse } from "next/server";
import { downloadRequestSchema } from "@lumio/shared";
import { listPhotosForDownload } from "@/lib/photos-service";
import { originalPath } from "@/lib/paths";
import { streamPhotosZip } from "@/lib/download-service";
import { withCatalog } from "@/lib/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withCatalog(async (request, _context, { catalog }) => {
  const body: unknown = await request.json();
  const parsed = downloadRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
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
