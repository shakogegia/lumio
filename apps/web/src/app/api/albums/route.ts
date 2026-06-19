import { NextResponse } from "next/server";
import { createAlbumSchema, deleteAlbumsSchema } from "@lumio/shared";
import { createAlbum, deleteAlbums, listAlbumSummaries } from "@/lib/albums-service";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async () => {
  const items = await listAlbumSummaries();
  return NextResponse.json({ items });
});

export const POST = withAuth(async (request) => {
  const body: unknown = await request.json();
  const parsed = createAlbumSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const album = await createAlbum(parsed.data);
  return NextResponse.json(album, { status: 201 });
});

export const DELETE = withAuth(async (request) => {
  const body: unknown = await request.json();
  const parsed = deleteAlbumsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const count = await deleteAlbums(parsed.data.ids);
  return NextResponse.json({ count });
});
