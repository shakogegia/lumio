import { NextResponse } from "next/server";
import { invalidateStorageStats } from "@/lib/status-service";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";

// Drops the memoized filesystem size/count figures so the next Settings render
// re-walks the directories. The client follows this with router.refresh().
export const POST = withAuth(async () => {
  invalidateStorageStats();
  return NextResponse.json({ status: "ok" });
});
