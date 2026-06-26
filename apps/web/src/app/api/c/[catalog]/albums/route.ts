import { NextResponse } from "next/server";
import { createAlbumSchema, deleteAlbumsSchema } from "@lumio/shared";
import { createAlbum, deleteAlbums, invalidRuleFields, listAlbumSummaries } from "@/lib/server/albums-service";
import { errorJson, parseJson } from "@/lib/server/route-helpers";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withCatalog(async (_request, _context, { catalog }) => {
  const items = await listAlbumSummaries(catalog.id);
  return NextResponse.json({ items });
});

export const POST = withCatalog(async (request, _context, { catalog }) => {
  const parsed = await parseJson(request, createAlbumSchema);
  if ("response" in parsed) return parsed.response;
  if (parsed.data.isSmart && parsed.data.rules) {
    const bad = await invalidRuleFields(catalog.id, parsed.data.rules.rules);
    if (bad.length) return errorJson("Unknown filter field(s): " + bad.join(", "), 400);
  }
  const album = await createAlbum(catalog.id, parsed.data);
  return NextResponse.json(album, { status: 201 });
});

export const DELETE = withCatalog(async (request, _context, { catalog }) => {
  const parsed = await parseJson(request, deleteAlbumsSchema);
  if ("response" in parsed) return parsed.response;
  const count = await deleteAlbums(catalog.id, parsed.data.ids);
  return NextResponse.json({ count });
});
