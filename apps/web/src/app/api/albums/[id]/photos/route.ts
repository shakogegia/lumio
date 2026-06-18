import { NextResponse } from "next/server";
import { albumPhotosSchema, photosQuerySchema } from "@lumio/shared";
import {
  addPhotosToAlbum,
  AlbumNotFoundError,
  listAlbumPhotos,
  removePhotosFromAlbum,
  SmartAlbumMutationError,
} from "@/lib/albums-service";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(
  async (request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const parsed = photosQuerySchema.safeParse(Object.fromEntries(searchParams));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const page = await listAlbumPhotos(id, parsed.data);
    if (!page) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }
    return NextResponse.json(page);
  },
);

export const POST = withAuth(
  async (request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const body: unknown = await request.json();
    const parsed = albumPhotosSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    try {
      const count = await addPhotosToAlbum(id, parsed.data.photoIds);
      return NextResponse.json({ status: "added", count }, { status: 201 });
    } catch (err) {
      if (err instanceof SmartAlbumMutationError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      if (err instanceof AlbumNotFoundError) {
        return NextResponse.json({ error: "Album not found" }, { status: 404 });
      }
      throw err;
    }
  },
);

export const DELETE = withAuth(
  async (request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const body: unknown = await request.json();
    const parsed = albumPhotosSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    try {
      const count = await removePhotosFromAlbum(id, parsed.data.photoIds);
      return NextResponse.json({ status: "removed", count });
    } catch (err) {
      if (err instanceof SmartAlbumMutationError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      if (err instanceof AlbumNotFoundError) {
        return NextResponse.json({ error: "Album not found" }, { status: 404 });
      }
      throw err;
    }
  },
);
