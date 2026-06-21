import { NextResponse } from "next/server";
import { setAlbumCoverSchema } from "@lumio/shared";
import {
  AlbumNotFoundError,
  deleteAlbum,
  getAlbum,
  PhotoNotInAlbumError,
  setAlbumCover,
  SmartAlbumMutationError,
} from "@/lib/albums-service";
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

export const PATCH = withAuth(
  async (request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const body: unknown = await request.json();
    const parsed = setAlbumCoverSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    try {
      await setAlbumCover(id, parsed.data.coverPhotoId);
      return NextResponse.json({ status: "ok" });
    } catch (err) {
      if (err instanceof AlbumNotFoundError) {
        return NextResponse.json({ error: "Album not found" }, { status: 404 });
      }
      if (err instanceof SmartAlbumMutationError || err instanceof PhotoNotInAlbumError) {
        return NextResponse.json({ error: err.message || "Bad request" }, { status: 400 });
      }
      throw err;
    }
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
