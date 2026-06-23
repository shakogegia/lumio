import { NextResponse } from "next/server";
import { isFeatureEnabled } from "@lumio/db";
import { FeatureKey } from "@lumio/shared";
import { buildCalendarFacets } from "@/lib/calendar-service";
import { errorJson } from "@/lib/route-helpers";
import { withCatalog } from "@/lib/with-catalog";

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
  const dir = new URL(request.url).searchParams.get("path") ?? "";
  const facets = await buildCalendarFacets(catalog.id, { dirPath: dir });
  return NextResponse.json(facets);
});
