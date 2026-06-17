import { NextResponse } from "next/server";
import { AlbumNotFoundError, deleteAlbum, getAlbum } from "@/lib/albums-service";

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
  try {
    await deleteAlbum(id);
  } catch (err) {
    if (err instanceof AlbumNotFoundError) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }
    throw err;
  }
  return new NextResponse(null, { status: 204 });
}
