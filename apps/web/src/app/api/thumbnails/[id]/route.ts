import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { thumbnailPath } from "@/lib/paths";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";

export const GET = withAuth(
  async (_request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    try {
      const file = await readFile(thumbnailPath(id));
      return new NextResponse(new Uint8Array(file), {
        headers: {
          "Content-Type": "image/webp",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    } catch {
      return NextResponse.json({ error: "Thumbnail not found" }, { status: 404 });
    }
  },
);
