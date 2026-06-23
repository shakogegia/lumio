import { NextResponse } from "next/server";
import { getAlbum, listAlbumPhotosForDownload } from "@/lib/server/albums-service";
import { originalPath } from "@/lib/server/server-paths";
import { sanitizeZipName, streamPhotosZip } from "@/lib/server/download-archive";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withCatalog<{ id: string }>(
  async (_request, context, { catalog }) => {
    const { id } = await context.params;
    const album = await getAlbum(catalog.id, id);
    if (!album) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }
    const photos = await listAlbumPhotosForDownload(catalog.id, id);
    if (photos === null) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }
    // An empty album streams a valid empty zip (no error page), so the header's
    // native-anchor download never lands the user on a JSON error.
    return streamPhotosZip(
      photos,
      `${sanitizeZipName(album.name)}.zip`,
      "original",
      (relPath) => originalPath(catalog, relPath),
    );
  },
);
