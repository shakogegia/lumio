import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { displayPath } from "@/lib/paths";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";

export const GET = withAuth(
  async (_request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    try {
      const file = await readFile(displayPath(id));
      return new NextResponse(new Uint8Array(file), {
        headers: {
          "Content-Type": "image/webp",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    } catch {
      return NextResponse.json({ error: "Display rendition not found" }, { status: 404 });
    }
  },
);
