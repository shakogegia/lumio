import { NextResponse } from "next/server";
import { prisma } from "@lumio/db";
import {
  WORKER_STALE_MS,
  buildActivitySnapshot,
  getActiveJobs,
  readWorkerStatus,
} from "@lumio/jobs";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async () => {
  const [worker, jobs] = await Promise.all([
    readWorkerStatus(prisma),
    getActiveJobs(prisma),
  ]);
  const snapshot = buildActivitySnapshot(worker, jobs, new Date(), WORKER_STALE_MS);
  return NextResponse.json(snapshot);
});
