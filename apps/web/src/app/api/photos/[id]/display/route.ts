import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { displayPath } from "@/lib/paths";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
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
}
