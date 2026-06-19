import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { thumbnailPath, trashThumbnailPath } from "@/lib/paths";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";

function webp(file: Buffer): NextResponse {
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

export const GET = withAuth(
  async (_request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    try {
      return webp(await readFile(thumbnailPath(id)));
    } catch {
      // Trashed photos keep their thumbnail under TRASH_DIR so the Trash grid
      // can render via the same /api/thumbnails/<id> URL.
      try {
        return webp(await readFile(trashThumbnailPath(id)));
      } catch {
        return NextResponse.json({ error: "Thumbnail not found" }, { status: 404 });
      }
    }
  },
);
