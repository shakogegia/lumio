import { NextResponse } from "next/server";
import { getAlbum, listAlbumPhotosForDownload } from "@/lib/albums-service";
import { sanitizeZipName, streamPhotosZip } from "@/lib/download-service";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(
  async (_request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const album = await getAlbum(id);
    if (!album) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }
    const photos = await listAlbumPhotosForDownload(id);
    if (photos === null) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }
    // An empty album streams a valid empty zip (no error page), so the header's
    // native-anchor download never lands the user on a JSON error.
    return streamPhotosZip(photos, `${sanitizeZipName(album.name)}.zip`);
  },
);
