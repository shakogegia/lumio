import { NextResponse } from "next/server";
import { purgeAllPhotos } from "@/lib/photos-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  const result = await purgeAllPhotos();
  return NextResponse.json(result);
}
