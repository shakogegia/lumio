import { NextResponse } from "next/server";
import { deleteAlbum, getAlbum } from "@/lib/albums-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const album = await getAlbum(id);
  if (!album) {
    return NextResponse.json({ error: "Album not found" }, { status: 404 });
  }
  return NextResponse.json(album);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  await deleteAlbum(id);
  return new NextResponse(null, { status: 204 });
}
