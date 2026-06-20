import { NextResponse } from "next/server";
import { buildCalendarFacets } from "@/lib/calendar-service";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async () => {
  const facets = await buildCalendarFacets({});
  return NextResponse.json(facets);
});
