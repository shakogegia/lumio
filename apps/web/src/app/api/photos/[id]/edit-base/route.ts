import { NextResponse } from "next/server";
import { decodeToSharpInput, buildEditBase } from "@lumio/ingest";
import { getPhoto } from "@/lib/photos-service";
import { originalPath } from "@/lib/paths";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(
  async (_request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const photo = await getPhoto(id);
    if (!photo) return NextResponse.json({ error: "Photo not found" }, { status: 404 });

    const decoded = await decodeToSharpInput(originalPath(photo.path));
    try {
      const webp = await buildEditBase(decoded.input);
      return new NextResponse(new Uint8Array(webp), {
        headers: {
          "Content-Type": "image/webp",
          // The edit-free base never changes for a given original.
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    } catch {
      return NextResponse.json({ error: "Original not found" }, { status: 404 });
    } finally {
      await decoded.cleanup();
    }
  },
);
