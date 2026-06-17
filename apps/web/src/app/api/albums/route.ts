import { NextResponse } from "next/server";
import { listAlbums } from "@/lib/albums-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const albums = await listAlbums();
  return NextResponse.json({ items: albums });
}
