import { NextResponse } from "next/server";
import { getPhoto } from "@/lib/photos-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const photo = await getPhoto(id);
  if (!photo) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }
  return NextResponse.json(photo);
}
