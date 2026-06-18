import { NextResponse } from "next/server";
import { purgeAllPhotos } from "@/lib/photos-service";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withAuth(async () => {
  const result = await purgeAllPhotos();
  return NextResponse.json(result);
});
