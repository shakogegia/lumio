import { NextResponse } from "next/server";
import { searchQuerySchema } from "@lumio/shared";
import { countSearchPhotos, searchPhotos } from "@/lib/search-service";
import { errorJson } from "@/lib/route-helpers";
import { withCatalog } from "@/lib/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withCatalog(async (request, _context, { catalog }) => {
  const { searchParams } = new URL(request.url);
  // `album` may repeat; getAll preserves every value (Object.fromEntries keeps only the last).
  // Cannot use parseQuery here — it flattens repeated params via Object.fromEntries.
  const parsed = searchQuerySchema.safeParse({
    ...Object.fromEntries(searchParams),
    album: searchParams.getAll("album"),
  });
  if (!parsed.success) {
    return errorJson("Invalid query parameters", 400, parsed.error.flatten());
  }
  // Lightweight count mode for the search toolbar: same filters, no pagination.
  if (searchParams.get("count")) {
    const total = await countSearchPhotos(catalog.id, parsed.data);
    return NextResponse.json({ total });
  }
  const page = await searchPhotos(catalog.id, parsed.data);
  return NextResponse.json(page);
});
