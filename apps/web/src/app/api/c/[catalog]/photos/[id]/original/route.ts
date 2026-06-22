import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { prisma } from "@lumio/db";
import { originalPath } from "@/lib/paths";
import { attachmentDisposition } from "@/lib/download-service";
import { withCatalog } from "@/lib/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export const GET = withCatalog<{ id: string }>(async (request, context, { catalog }) => {
  const { id } = await context.params;
  const photo = await prisma.photo.findFirst({
    where: { id, catalogId: catalog.id },
    select: { id: true, path: true },
  });
  if (!photo) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }
  try {
    const file = await readFile(originalPath(catalog, photo.path));
    const ext = photo.path.slice(photo.path.lastIndexOf(".")).toLowerCase();
    const headers: Record<string, string> = {
      "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      "Cache-Control": "public, max-age=3600",
    };
    // Opt-in download mode: force a save with the original's filename.
    if (new URL(request.url).searchParams.get("download")) {
      const base = photo.path.split("/").pop() || photo.path;
      headers["Content-Disposition"] = attachmentDisposition(base);
    }
    return new NextResponse(new Uint8Array(file), { headers });
  } catch {
    return NextResponse.json({ error: "Original not found" }, { status: 404 });
  }
});
