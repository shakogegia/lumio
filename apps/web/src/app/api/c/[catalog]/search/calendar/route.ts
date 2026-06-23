import { NextResponse } from "next/server";
import { buildSearchWhere } from "@lumio/db";
import { searchQuerySchema } from "@lumio/shared";
import { buildCalendarFacets } from "@/lib/server/calendar-service";
import { errorJson } from "@/lib/server/route-helpers";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withCatalog(async (request, _context, { catalog }) => {
  const { searchParams } = new URL(request.url);
  // `album` may repeat; cannot use parseQuery — it flattens repeated params via Object.fromEntries.
  const parsed = searchQuerySchema.safeParse({
    ...Object.fromEntries(searchParams),
    album: searchParams.getAll("album"),
  });
  if (!parsed.success) {
    return errorJson("Invalid query parameters", 400, parsed.error.flatten());
  }
  // buildSearchWhere reads only album + q, so any `month` param is ignored here.
  const facets = await buildCalendarFacets(catalog.id, buildSearchWhere(parsed.data));
  return NextResponse.json(facets);
});
