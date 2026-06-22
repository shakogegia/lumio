import { NextResponse } from "next/server";
import { prisma } from "@lumio/db";
import {
  WORKER_STALE_MS,
  buildActivitySnapshot,
  getActiveJobs,
  readWorkerStatus,
} from "@lumio/jobs";
import { withCatalog } from "@/lib/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Worker status is global; jobs are all active jobs across all catalogs.
// The client can filter to this catalog's jobs using the catalogId in each job.
export const GET = withCatalog(async (_request, _context, _extras) => {
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
