import { NextResponse } from "next/server";
import { buildCalendarFacets } from "@/lib/calendar-service";
import { withCatalog } from "@/lib/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withCatalog(async (request, _context, { catalog }) => {
  // `?favorite=true` scopes the month facets to favorites (the /favorites view);
  // otherwise the whole library.
  const favorite = new URL(request.url).searchParams.get("favorite") === "true";
  const facets = await buildCalendarFacets(catalog.id, favorite ? { isFavorite: true } : {});
  return NextResponse.json(facets);
});
