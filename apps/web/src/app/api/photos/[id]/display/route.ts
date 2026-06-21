import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { displayPath, editedDisplayPath } from "@/lib/paths";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";

export const GET = withAuth(
  async (request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const wantEdited = new URL(request.url).searchParams.get("edited");
    const webp = (file: Buffer) =>
      new NextResponse(new Uint8Array(file), {
        headers: {
          "Content-Type": "image/webp",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    try {
      if (wantEdited) {
        try {
          return webp(await readFile(editedDisplayPath(id)));
        } catch {
          // edited variant missing → fall back to the base
        }
      }
      return webp(await readFile(displayPath(id)));
    } catch {
      return NextResponse.json({ error: "Display rendition not found" }, { status: 404 });
    }
  },
);
