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
  try {
    const [worker, jobs] = await Promise.all([
      readWorkerStatus(prisma),
      getActiveJobs(prisma),
    ]);
    const snapshot = buildActivitySnapshot(worker, jobs, new Date(), WORKER_STALE_MS);
    return NextResponse.json(snapshot);
  } catch {
    // DB unreachable → report the worker as offline rather than 500-ing the poller.
    return NextResponse.json(
      { worker: { online: false, activity: "offline" }, jobs: [] },
      { status: 503 },
    );
  }
});
