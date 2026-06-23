import { NextResponse } from "next/server";
import { createAlbumSchema, deleteAlbumsSchema } from "@lumio/shared";
import { createAlbum, deleteAlbums, listAlbumSummaries } from "@/lib/albums-service";
import { parseJson } from "@/lib/route-helpers";
import { withCatalog } from "@/lib/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withCatalog(async (_request, _context, { catalog }) => {
  const items = await listAlbumSummaries(catalog.id);
  return NextResponse.json({ items });
});

export const POST = withCatalog(async (request, _context, { catalog }) => {
  const parsed = await parseJson(request, createAlbumSchema);
  if ("response" in parsed) return parsed.response;
  const album = await createAlbum(catalog.id, parsed.data);
  return NextResponse.json(album, { status: 201 });
});

export const DELETE = withCatalog(async (request, _context, { catalog }) => {
  const parsed = await parseJson(request, deleteAlbumsSchema);
  if ("response" in parsed) return parsed.response;
  const count = await deleteAlbums(catalog.id, parsed.data.ids);
  return NextResponse.json({ count });
});
