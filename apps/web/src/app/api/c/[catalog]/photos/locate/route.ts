import { NextResponse } from "next/server";
import { withCatalog } from "@/lib/server/with-catalog";
import { parseDetailScope } from "@/lib/server/photo-detail-loader";
import { locatePhoto } from "@/lib/server/locate-photo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Resolve a photo id to its absolute index within a navigation scope, so the
// client can open the lightbox at the right grid position. Read-only.
export const GET = withCatalog(async (request, _context, { catalog }) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  const scope = parseDetailScope({
    album: searchParams.getAll("album"),
    q: searchParams.get("q") ?? undefined,
    s: searchParams.get("s") ?? undefined,
    sort: searchParams.get("sort") ?? undefined,
    folder: searchParams.get("folder") ?? undefined,
  });
  const index = await locatePhoto(catalog.id, id, scope);
  if (index === null) {
    return NextResponse.json({ error: "Not found in scope" }, { status: 404 });
  }
  return NextResponse.json({ index });
});
