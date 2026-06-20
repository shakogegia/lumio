import { NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import { parseDetailScope } from "@/lib/photo-detail-loader";
import { locatePhoto } from "@/lib/locate-photo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Resolve a photo id to its absolute index within a navigation scope, so the
// client can open the lightbox at the right grid position. Read-only.
export const GET = withAuth(async (request) => {
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
  });
  const index = await locatePhoto(id, scope);
  if (index === null) {
    return NextResponse.json({ error: "Not found in scope" }, { status: 404 });
  }
  return NextResponse.json({ index });
});
