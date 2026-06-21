import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { displayPath, editedDisplayPath } from "@/lib/paths";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";

export const GET = withAuth(
  async (request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
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
          return webp(await readFile(editedDisplayPath(id)));
        } catch {
          // no edited variant → fall through to the base
        }
      }
      return webp(await readFile(displayPath(id)));
    } catch {
      return NextResponse.json({ error: "Display rendition not found" }, { status: 404 });
    }
  },
);
