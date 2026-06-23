import { NextResponse } from "next/server";
import { prisma } from "@lumio/db";
import { getWorkerLogs } from "@lumio/jobs";
import { logsQuerySchema, type LogsResponse } from "@lumio/shared";
import { withAuth } from "@/lib/server/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Worker logs are global (a single worker). Auth is "logged-in" only, like the
 * other settings endpoints. Newest-first, cursor-paged via `before`.
 */
export const GET = withAuth(async (request) => {
  const url = new URL(request.url);
  const parsed = logsQuerySchema.safeParse({
    level: url.searchParams.get("level") ?? undefined,
    before: url.searchParams.get("before") ?? undefined,
    since: url.searchParams.get("since") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }
  const { level, before, since, limit } = parsed.data;

  try {
    const entries = await getWorkerLogs(prisma, {
      levels: level,
      before: before ? new Date(before) : undefined,
      after: since ? new Date(since) : undefined,
      limit,
    });
    // A full page implies there may be older rows; hand back the oldest as the cursor.
    const nextBefore = entries.length === limit ? entries[entries.length - 1]!.createdAt : null;
    return NextResponse.json({ entries, nextBefore } satisfies LogsResponse);
  } catch {
    // DB unreachable → empty page rather than 500-ing the poller (mirrors /activity).
    return NextResponse.json({ entries: [], nextBefore: null } satisfies LogsResponse, { status: 503 });
  }
});
