import { NextResponse } from "next/server";
import { purgeTrash } from "@/lib/trash-service";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withAuth(async () => {
  const result = await purgeTrash(undefined);
  return NextResponse.json(result);
});
