import { NextResponse } from "next/server";
import { prisma } from "@lumio/db";
import { enqueueJob } from "@lumio/jobs";
import { JobType } from "@lumio/shared";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withAuth(async () => {
  const job = await enqueueJob(prisma, JobType.rescan);
  return NextResponse.json({ jobId: job.id }, { status: 202 });
});
