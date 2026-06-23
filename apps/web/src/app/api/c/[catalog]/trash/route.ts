import { NextResponse } from "next/server";
import { photosQuerySchema } from "@lumio/shared";
import { listTrash } from "@/lib/server/trash-service";
import { parseQuery } from "@/lib/server/route-helpers";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withCatalog(async (request, _context, { catalog }) => {
  const parsed = parseQuery(request, photosQuerySchema);
  if ("response" in parsed) return parsed.response;
  const page = await listTrash(catalog.id, parsed.data);
  return NextResponse.json(page);
});
