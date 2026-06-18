import { NextResponse } from "next/server";
import { addPhotoSchema, photosQuerySchema } from "@lumio/shared";
import {
  addPhotoToAlbum,
  AlbumNotFoundError,
  listAlbumPhotos,
  SmartAlbumMutationError,
} from "@/lib/albums-service";
import { requireSession } from "@/lib/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireSession();
  if (guard.response) return guard.response;

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
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireSession();
  if (guard.response) return guard.response;

  const { id } = await params;
  const body: unknown = await request.json();
  const parsed = addPhotoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { photoId } = parsed.data;
  try {
    await addPhotoToAlbum(id, photoId);
  } catch (err) {
    if (err instanceof SmartAlbumMutationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof AlbumNotFoundError) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }
    throw err;
  }
  return NextResponse.json({ status: "added" }, { status: 201 });
}
