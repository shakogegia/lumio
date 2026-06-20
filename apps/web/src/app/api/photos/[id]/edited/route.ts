import sharp from "sharp";
import { NextResponse } from "next/server";
import { hasEdits } from "@lumio/shared";
import { applyEdits, decodeToSharpInput } from "@lumio/ingest";
import { getPhoto } from "@/lib/photos-service";
import { originalPath } from "@/lib/paths";
import { attachmentDisposition } from "@/lib/download-service";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** basename with the extension swapped to .jpg */
function jpegName(relPath: string): string {
  const base = relPath.split("/").pop() || relPath;
  const dot = base.lastIndexOf(".");
  return `${dot > 0 ? base.slice(0, dot) : base}.jpg`;
}

export const GET = withAuth(
  async (request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const photo = await getPhoto(id);
    if (!photo) return NextResponse.json({ error: "Photo not found" }, { status: 404 });

    const decoded = await decodeToSharpInput(originalPath(photo.path));
    try {
      const oriented = await sharp(decoded.input).rotate().toBuffer();
      const recipe = hasEdits(photo.edits) ? photo.edits : null;
      const jpeg = await applyEdits(sharp(oriented), recipe).jpeg({ quality: 92 }).toBuffer();
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
  },
);
