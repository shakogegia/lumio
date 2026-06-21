import { NextResponse } from "next/server";
import { listAllFolders } from "@/lib/folders-service";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async () => {
  const items = await listAllFolders();
  return NextResponse.json({ items });
});
