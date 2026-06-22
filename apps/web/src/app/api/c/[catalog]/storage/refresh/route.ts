import { NextResponse } from "next/server";
import { invalidateStorageStats } from "@/lib/status-service";
import { withCatalog } from "@/lib/with-catalog";

export const runtime = "nodejs";

// Drops the memoized filesystem size/count figures for this catalog so the
// next Settings render re-walks the directories. The client follows this
// with router.refresh().
export const POST = withCatalog(async (_request, _context, { catalog }) => {
  invalidateStorageStats(catalog.id);
  return NextResponse.json({ status: "ok" });
});
