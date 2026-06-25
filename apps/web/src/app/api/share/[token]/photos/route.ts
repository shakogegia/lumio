import { NextResponse } from "next/server";
import { photosQuerySchema } from "@lumio/shared";
import { withShare } from "@/lib/server/with-share";
import { parseQuery } from "@/lib/server/route-helpers";
import { listShareLinkPhotos } from "@/lib/server/share-links-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withShare(async (request, _context, { shareLink, catalog }) => {
  const parsed = parseQuery(request, photosQuerySchema);
  if ("response" in parsed) return parsed.response;
  const page = await listShareLinkPhotos(catalog.id, shareLink.id, parsed.data);
  return NextResponse.json(page);
});
