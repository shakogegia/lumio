import { NextResponse } from "next/server";
import { createAlbumSchema, deleteAlbumsSchema } from "@lumio/shared";
import { createAlbum, deleteAlbums, listAlbumSummaries } from "@/lib/albums-service";
import { withCatalog } from "@/lib/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withCatalog(async (_request, _context, { catalog }) => {
  const items = await listAlbumSummaries(catalog.id);
  return NextResponse.json({ items });
});

export const POST = withCatalog(async (request, _context, { catalog }) => {
  const body: unknown = await request.json();
  const parsed = createAlbumSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const album = await createAlbum(catalog.id, parsed.data);
  return NextResponse.json(album, { status: 201 });
});

export const DELETE = withCatalog(async (request, _context, { catalog }) => {
  const body: unknown = await request.json();
  const parsed = deleteAlbumsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const count = await deleteAlbums(catalog.id, parsed.data.ids);
  return NextResponse.json({ count });
});
