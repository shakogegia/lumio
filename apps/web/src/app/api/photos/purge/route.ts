import { NextResponse } from "next/server";
import { purgeAllPhotos } from "@/lib/photos-service";
import { requireSession } from "@/lib/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  const guard = await requireSession();
  if (guard.response) return guard.response;

  const result = await purgeAllPhotos();
  return NextResponse.json(result);
}
