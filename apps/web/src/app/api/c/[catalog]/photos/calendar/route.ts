import { NextResponse } from "next/server";
import { buildCalendarFacets } from "@/lib/calendar-service";
import { withCatalog } from "@/lib/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withCatalog(async (_request, _context, { catalog }) => {
  const facets = await buildCalendarFacets(catalog.id, {});
  return NextResponse.json(facets);
});
