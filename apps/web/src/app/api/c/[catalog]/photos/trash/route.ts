import { NextResponse } from "next/server";
import { prisma } from "@lumio/db";
import { enqueueJob } from "@lumio/jobs";
import { JobType, photoIdsSchema } from "@lumio/shared";
import { markPhotosTrashed } from "@/lib/server/trash-service";
import { parseJson } from "@/lib/server/route-helpers";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Optimistic trash: mark the rows (instant) and enqueue the worker to do the
// heavy lifting (snapshot + file moves) asynchronously. The grid already removed
// the tiles client-side; live queries filter trashedAt IS NULL, so the photos are
// gone from every view the moment this returns.
export const POST = withCatalog(async (request, _context, { catalog }) => {
  const parsed = await parseJson(request, photoIdsSchema);
  if ("response" in parsed) return parsed.response;
  const result = await markPhotosTrashed(catalog.id, parsed.data.ids, prisma);
  if (result.trashed > 0) await enqueueJob(prisma, JobType.process_trash, catalog.id);
  return NextResponse.json(result);
});
