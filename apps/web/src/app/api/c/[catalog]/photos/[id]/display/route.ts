import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { prisma } from "@lumio/db";
import { displayPath, editedDisplayPath } from "@/lib/paths";
import { withCatalog } from "@/lib/with-catalog";

export const runtime = "nodejs";

export const GET = withCatalog<{ id: string }>(async (request, context, { catalog }) => {
  const { id } = await context.params;
  const photo = await prisma.photo.findFirst({
    where: { id, catalogId: catalog.id },
    select: { id: true },
  });
  if (!photo) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const base = new URL(request.url).searchParams.get("base");
  const webp = (file: Buffer) =>
    new NextResponse(new Uint8Array(file), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  try {
    if (!base) {
      // Default: the current image — edited variant if present, else the base.
      try {
        return webp(await readFile(editedDisplayPath(catalog.id, id)));
      } catch {
        // no edited variant → fall through to the base
      }
    }
    return webp(await readFile(displayPath(catalog.id, id)));
  } catch {
    return NextResponse.json({ error: "Display rendition not found" }, { status: 404 });
  }
});
