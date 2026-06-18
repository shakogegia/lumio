import { NextResponse } from "next/server";
import { createAlbumSchema } from "@lumio/shared";
import { createAlbum, listAlbumSummaries } from "@/lib/albums-service";
import { requireSession } from "@/lib/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const guard = await requireSession();
  if (guard.response) return guard.response;

  const items = await listAlbumSummaries();
  return NextResponse.json({ items });
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireSession();
  if (guard.response) return guard.response;

  const body: unknown = await request.json();
  const parsed = createAlbumSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const album = await createAlbum(parsed.data);
  return NextResponse.json(album, { status: 201 });
}
