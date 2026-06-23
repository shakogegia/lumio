import { NextResponse } from "next/server";
import { moveItemsSchema } from "@lumio/shared";
import { moveItems } from "@/lib/folders-service";
import { parseJson, mapServiceError } from "@/lib/route-helpers";
import { withCatalog } from "@/lib/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withCatalog(async (request, _context, { catalog }) => {
  const parsed = await parseJson(request, moveItemsSchema);
  if ("response" in parsed) return parsed.response;
  try {
    const count = await moveItems(catalog.id, parsed.data);
    return NextResponse.json({ count });
  } catch (err) {
    const mapped = mapServiceError(err);
    if (mapped) return mapped;
    throw err;
  }
});
