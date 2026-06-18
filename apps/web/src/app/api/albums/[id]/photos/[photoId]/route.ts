import { NextResponse } from "next/server";
import { removePhotoFromAlbum } from "@/lib/albums-service";
import { requireSession } from "@/lib/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> },
): Promise<NextResponse> {
  const guard = await requireSession();
  if (guard.response) return guard.response;

  const { id, photoId } = await params;
  await removePhotoFromAlbum(id, photoId);
  return new NextResponse(null, { status: 204 });
}
