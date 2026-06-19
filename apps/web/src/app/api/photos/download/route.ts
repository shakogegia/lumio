import { NextResponse } from "next/server";
import { photoIdsSchema } from "@lumio/shared";
import { listPhotosForDownload } from "@/lib/photos-service";
import { streamPhotosZip } from "@/lib/download-service";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withAuth(async (request) => {
  const body: unknown = await request.json();
  const parsed = photoIdsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const photos = await listPhotosForDownload(parsed.data.ids);
  if (photos.length === 0) {
    return NextResponse.json({ error: "No photos found" }, { status: 404 });
  }
  return streamPhotosZip(photos, `lumio-photos-${photos.length}.zip`);
});
