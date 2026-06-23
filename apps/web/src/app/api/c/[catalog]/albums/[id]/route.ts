import { NextResponse } from "next/server";
import { renameAlbumSchema, setAlbumCoverSchema } from "@lumio/shared";
import {
  deleteAlbum,
  getAlbum,
  renameAlbum,
  setAlbumCover,
} from "@/lib/server/albums-service";
import { errorJson, mapServiceError } from "@/lib/server/route-helpers";
import { withCatalog } from "@/lib/server/with-catalog";

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
    const body: unknown = await request.json().catch(() => null);

    // Rename takes precedence when a `name` is present; otherwise set the cover.
    const rename = renameAlbumSchema.safeParse(body);
    if (rename.success) {
      try {
        const album = await renameAlbum(catalog.id, id, rename.data.name);
        return NextResponse.json(album);
      } catch (err) {
        const mapped = mapServiceError(err);
        if (mapped) return mapped;
        throw err;
      }
    }

    const cover = setAlbumCoverSchema.safeParse(body);
    if (!cover.success) {
      return errorJson("Invalid request body", 400, cover.error.flatten());
    }
    try {
      await setAlbumCover(catalog.id, id, cover.data.coverPhotoId);
      return NextResponse.json({ status: "ok" });
    } catch (err) {
      const mapped = mapServiceError(err);
      if (mapped) return mapped;
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
      const mapped = mapServiceError(err);
      if (mapped) return mapped;
      throw err;
    }
    return new NextResponse(null, { status: 204 });
  },
);
