import { NextResponse } from "next/server";
import { removePhotoFromAlbum } from "@/lib/albums-service";
import { withCatalog } from "@/lib/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = withCatalog<{ id: string; photoId: string }>(
  async (_request, context, { catalog }) => {
    const { id, photoId } = await context.params;
    await removePhotoFromAlbum(catalog.id, id, photoId);
    return new NextResponse(null, { status: 204 });
  },
);
