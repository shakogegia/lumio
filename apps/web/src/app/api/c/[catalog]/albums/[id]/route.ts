import { NextResponse } from "next/server";
import { renameAlbumSchema, setAlbumCoverSchema } from "@lumio/shared";
import {
  AlbumNotFoundError,
  deleteAlbum,
  getAlbum,
  PhotoNotInAlbumError,
  renameAlbum,
  setAlbumCover,
  SmartAlbumMutationError,
} from "@/lib/albums-service";
import { withCatalog } from "@/lib/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withCatalog<{ id: string }>(
  async (_request, context, { catalog }) => {
    const { id } = await context.params;
    const album = await getAlbum(catalog.id, id);
    if (!album) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }
    return NextResponse.json(album);
  },
);

export const PATCH = withCatalog<{ id: string }>(
  async (request, context, { catalog }) => {
    const { id } = await context.params;
    const body: unknown = await request.json();

    // Rename takes precedence when a `name` is present; otherwise set the cover.
    const rename = renameAlbumSchema.safeParse(body);
    if (rename.success) {
      try {
        const album = await renameAlbum(catalog.id, id, rename.data.name);
        return NextResponse.json(album);
      } catch (err) {
        if (err instanceof AlbumNotFoundError) {
          return NextResponse.json({ error: "Album not found" }, { status: 404 });
        }
        throw err;
      }
    }

    const cover = setAlbumCoverSchema.safeParse(body);
    if (!cover.success) {
      return NextResponse.json({ error: cover.error.flatten() }, { status: 400 });
    }
    try {
      await setAlbumCover(catalog.id, id, cover.data.coverPhotoId);
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

export const DELETE = withCatalog<{ id: string }>(
  async (_request, context, { catalog }) => {
    const { id } = await context.params;
    try {
      await deleteAlbum(catalog.id, id);
    } catch (err) {
      if (err instanceof AlbumNotFoundError) {
        return NextResponse.json({ error: "Album not found" }, { status: 404 });
      }
      throw err;
    }
    return new NextResponse(null, { status: 204 });
  },
);
