import { NextResponse } from "next/server";
import { decodeToSharpInput, encodeEditedJpeg } from "@lumio/ingest";
import { wbBaselineOf } from "@lumio/shared";
import { getPhoto } from "@/lib/server/photos-service";
import { originalPath } from "@/lib/server/server-paths";
import { attachmentDisposition, jpegName } from "@/lib/server/download-archive";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withCatalog<{ id: string }>(async (request, context, { catalog }) => {
  const { id } = await context.params;
  const photo = await getPhoto(catalog.id, id);
  if (!photo) return NextResponse.json({ error: "Photo not found" }, { status: 404 });

  const decoded = await decodeToSharpInput(originalPath(catalog, photo.path));
  try {
    const jpeg = await encodeEditedJpeg(decoded.input, photo.edits, wbBaselineOf(photo));
    const headers: Record<string, string> = {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=0, must-revalidate",
    };
    if (new URL(request.url).searchParams.get("download")) {
      headers["Content-Disposition"] = attachmentDisposition(jpegName(photo.path));
    }
    return new NextResponse(new Uint8Array(jpeg), { headers });
  } catch {
    return NextResponse.json({ error: "Original not found" }, { status: 404 });
  } finally {
    await decoded.cleanup();
  }
});
