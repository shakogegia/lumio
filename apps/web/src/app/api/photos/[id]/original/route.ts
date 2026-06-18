import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getPhoto } from "@/lib/photos-service";
import { originalPath } from "@/lib/paths";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export const GET = withAuth(
  async (_request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const photo = await getPhoto(id);
    if (!photo) {
      return NextResponse.json({ error: "Photo not found" }, { status: 404 });
    }
    try {
      const file = await readFile(originalPath(photo.path));
      const ext = photo.path.slice(photo.path.lastIndexOf(".")).toLowerCase();
      return new NextResponse(new Uint8Array(file), {
        headers: {
          "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
          "Cache-Control": "public, max-age=3600",
        },
      });
    } catch {
      return NextResponse.json({ error: "Original not found" }, { status: 404 });
    }
  },
);
