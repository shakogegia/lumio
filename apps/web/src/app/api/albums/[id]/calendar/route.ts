import { NextResponse } from "next/server";
import { albumPhotoWhere } from "@/lib/albums-service";
import { buildCalendarFacets } from "@/lib/calendar-service";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(
  async (_request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const where = await albumPhotoWhere(id);
    if (where === null) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }
    const facets = await buildCalendarFacets(where);
    return NextResponse.json(facets);
  },
);
