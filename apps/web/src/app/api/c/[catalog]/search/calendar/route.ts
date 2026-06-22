import { NextResponse } from "next/server";
import { buildSearchWhere } from "@lumio/db";
import { searchQuerySchema } from "@lumio/shared";
import { buildCalendarFacets } from "@/lib/calendar-service";
import { withCatalog } from "@/lib/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withCatalog(async (request, _context, { catalog }) => {
  const { searchParams } = new URL(request.url);
  const parsed = searchQuerySchema.safeParse({
    ...Object.fromEntries(searchParams),
    album: searchParams.getAll("album"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  // buildSearchWhere reads only album + q, so any `month` param is ignored here.
  const facets = await buildCalendarFacets(catalog.id, buildSearchWhere(parsed.data));
  return NextResponse.json(facets);
});
