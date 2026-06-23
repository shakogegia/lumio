import { NextResponse } from "next/server";
import { setFavoriteSchema } from "@lumio/shared";
import { setPhotoFavorite } from "@/lib/photos-service";
import { parseJson } from "@/lib/route-helpers";
import { withCatalog } from "@/lib/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withCatalog(async (request, _context, { catalog }) => {
  const parsed = await parseJson(request, setFavoriteSchema);
  if ("response" in parsed) return parsed.response;
  const count = await setPhotoFavorite(catalog.id, parsed.data.photoIds, parsed.data.isFavorite);
  return NextResponse.json({ status: "favorited", count });
});
