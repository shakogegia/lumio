import { NextResponse } from "next/server";
import { coerceCalendarField } from "@lumio/shared";
import { buildCalendarFacets } from "@/lib/server/calendar-service";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withCatalog(async (request, _context, { catalog }) => {
  // `?favorite=true` scopes the month facets to favorites (the /favorites view);
  // otherwise the whole library.
  const { searchParams } = new URL(request.url);
  const favorite = searchParams.get("favorite") === "true";
  const dateField = coerceCalendarField(searchParams.get("dateField") ?? undefined);
  const facets = await buildCalendarFacets(catalog.id, favorite ? { isFavorite: true } : {}, dateField);
  return NextResponse.json(facets);
});
