import { NextResponse } from "next/server";
import { removePhotoFromAlbum } from "@/lib/albums-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> },
): Promise<NextResponse> {
  const { id, photoId } = await params;
  await removePhotoFromAlbum(id, photoId);
  return new NextResponse(null, { status: 204 });
}
