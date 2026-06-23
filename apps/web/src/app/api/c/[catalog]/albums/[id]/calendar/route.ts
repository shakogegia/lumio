import { NextResponse } from "next/server";
import { albumPhotoWhere } from "@/lib/server/albums-service";
import { buildCalendarFacets } from "@/lib/server/calendar-service";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withCatalog<{ id: string }>(
  async (_request, context, { catalog }) => {
    const { id } = await context.params;
    const where = await albumPhotoWhere(catalog.id, id);
    if (where === null) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }
    const facets = await buildCalendarFacets(catalog.id, where);
    return NextResponse.json(facets);
  },
);
