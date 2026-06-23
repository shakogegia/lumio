import { NextResponse } from "next/server";
import { prisma } from "@lumio/db";
import { enqueueJob } from "@lumio/jobs";
import { JobType } from "@lumio/shared";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withCatalog(async (_request, _context, { catalog }) => {
  const job = await enqueueJob(prisma, JobType.empty_trash, catalog.id);
  return NextResponse.json({ jobId: job.id }, { status: 202 });
});
