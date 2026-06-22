import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { prisma } from "@lumio/db";
import { thumbnailPath, trashThumbnailPath } from "@/lib/paths";
import { withCatalog } from "@/lib/with-catalog";

export const runtime = "nodejs";

function webp(file: Buffer): NextResponse {
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

export const GET = withCatalog<{ id: string }>(async (_request, context, { catalog }) => {
  const { id } = await context.params;
  // Verify ownership: photo or trashed photo must belong to this catalog.
  const [photo, trashed] = await Promise.all([
    prisma.photo.findFirst({ where: { id, catalogId: catalog.id }, select: { id: true } }),
    prisma.trashedPhoto.findFirst({ where: { id, catalogId: catalog.id }, select: { id: true } }),
  ]);
  if (!photo && !trashed) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    return webp(await readFile(thumbnailPath(catalog.id, id)));
  } catch {
    // Trashed photos keep their thumbnail under TRASH_DIR so the Trash grid
    // can render via the same URL.
    try {
      return webp(await readFile(trashThumbnailPath(catalog.id, id)));
    } catch {
      return NextResponse.json({ error: "Thumbnail not found" }, { status: 404 });
    }
  }
});
