import { NextResponse } from "next/server";
import { buildSearchWhere, getCatalogSchema } from "@lumio/db";
import { buildSearchRegistry, searchQuerySchema } from "@lumio/shared";
import { albumsSearchWhere } from "@/lib/server/albums-service";
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
  const now = new Date();
  const registry = buildSearchRegistry(await getCatalogSchema(catalog.id));
  // Resolve tagged albums to a smart-aware predicate so the calendar dots reflect
  // smart albums too (not just regular-album membership).
  const albumWhere = await albumsSearchWhere(catalog.id, parsed.data.album, { now, registry });
  // buildSearchWhere reads only album + q, so any `month` param is ignored here.
  const facets = await buildCalendarFacets(catalog.id, buildSearchWhere(parsed.data, now, registry, albumWhere));
  return NextResponse.json(facets);
});
