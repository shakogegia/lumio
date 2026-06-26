import { NextResponse } from "next/server";
import { decodeToSharpInput, encodeEditedJpeg } from "@lumio/ingest";
import { wbBaselineOf } from "@lumio/shared";
import { getPhoto } from "@/lib/server/photos-service";
import { originalPath } from "@/lib/server/server-paths";
import { attachmentDisposition, jpegName } from "@/lib/server/download-archive";
import { withShare } from "@/lib/server/with-share";
import { shareLinkPhotoExists } from "@/lib/server/share-links-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withShare<{ id: string }>(async (_request, context, { shareLink, catalog }) => {
  const { id } = await context.params;
  if (!(await shareLinkPhotoExists(shareLink.id, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const photo = await getPhoto(catalog.id, id);
  if (!photo) return NextResponse.json({ error: "Photo not found" }, { status: 404 });

  const decoded = await decodeToSharpInput(originalPath(catalog, photo.path));
  try {
    const jpeg = await encodeEditedJpeg(decoded.input, photo.edits, wbBaselineOf(photo));
    return new NextResponse(new Uint8Array(jpeg), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=0, must-revalidate",
        "Content-Disposition": attachmentDisposition(jpegName(photo.path)),
      },
    });
  } catch {
    return NextResponse.json({ error: "Original not found" }, { status: 404 });
  } finally {
    await decoded.cleanup();
  }
});
