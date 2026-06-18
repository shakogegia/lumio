import { NextResponse } from "next/server";
import { AlbumNotFoundError, deleteAlbum, getAlbum } from "@/lib/albums-service";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(
  async (_request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const album = await getAlbum(id);
    if (!album) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }
    return NextResponse.json(album);
  },
);

export const DELETE = withAuth(
  async (_request, { params }: { params: Promise<{ id: string }> }) => {
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
  },
);
