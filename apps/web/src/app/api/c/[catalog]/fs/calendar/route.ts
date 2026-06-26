import { NextResponse } from "next/server";
import { isFeatureEnabled } from "@lumio/db";
import { FeatureKey, coerceCalendarField } from "@lumio/shared";
import { buildCalendarFacets } from "@/lib/server/calendar-service";
import { errorJson } from "@/lib/server/route-helpers";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Year→month calendar facets for the photos that live DIRECTLY in directory
 * `?path=<rel>` (default root) — matching the /folders grid, which is also direct
 * (not recursive). Gated by the disk-explorer feature.
 */
export const GET = withCatalog(async (request, _context, { catalog }) => {
  if (!(await isFeatureEnabled(catalog.id, FeatureKey.DiskExplorer))) {
    return errorJson("Not found", 404);
  }
  const { searchParams } = new URL(request.url);
  const dir = searchParams.get("path") ?? "";
  const dateField = coerceCalendarField(searchParams.get("dateField") ?? undefined);
  const facets = await buildCalendarFacets(catalog.id, { dirPath: dir }, dateField);
  return NextResponse.json(facets);
});
