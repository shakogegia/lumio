import { NextResponse } from "next/server";
import { removePhotoFromAlbum } from "@/lib/albums-service";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = withAuth(
  async (_request, { params }: { params: Promise<{ id: string; photoId: string }> }) => {
    const { id, photoId } = await params;
    await removePhotoFromAlbum(id, photoId);
    return new NextResponse(null, { status: 204 });
  },
);
