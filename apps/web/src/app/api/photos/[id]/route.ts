import { NextResponse } from "next/server";
import { getPhoto } from "@/lib/photos-service";
import { requireSession } from "@/lib/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireSession();
  if (guard.response) return guard.response;

  const { id } = await params;
  const photo = await getPhoto(id);
  if (!photo) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }
  return NextResponse.json(photo);
}
