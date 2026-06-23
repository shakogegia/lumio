import { NextResponse } from "next/server";
import { albumPhotosSchema, photosQuerySchema } from "@lumio/shared";
import {
  addPhotosToAlbum,
  listAlbumPhotos,
  removePhotosFromAlbum,
} from "@/lib/albums-service";
import { parseJson, parseQuery, mapServiceError } from "@/lib/route-helpers";
import { withCatalog } from "@/lib/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withCatalog<{ id: string }>(
  async (request, context, { catalog }) => {
    const { id } = await context.params;
    const parsed = parseQuery(request, photosQuerySchema);
    if ("response" in parsed) return parsed.response;
    const page = await listAlbumPhotos(catalog.id, id, parsed.data);
    if (!page) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }
    return NextResponse.json(page);
  },
);

export const POST = withCatalog<{ id: string }>(
  async (request, context, { catalog }) => {
    const { id } = await context.params;
    const parsed = await parseJson(request, albumPhotosSchema);
    if ("response" in parsed) return parsed.response;
    try {
      const count = await addPhotosToAlbum(catalog.id, id, parsed.data.photoIds);
      return NextResponse.json({ status: "added", count }, { status: 201 });
    } catch (err) {
      const mapped = mapServiceError(err);
      if (mapped) return mapped;
      throw err;
    }
  },
);

export const DELETE = withCatalog<{ id: string }>(
  async (request, context, { catalog }) => {
    const { id } = await context.params;
    const parsed = await parseJson(request, albumPhotosSchema);
    if ("response" in parsed) return parsed.response;
    try {
      const count = await removePhotosFromAlbum(catalog.id, id, parsed.data.photoIds);
      return NextResponse.json({ status: "removed", count });
    } catch (err) {
      const mapped = mapServiceError(err);
      if (mapped) return mapped;
      throw err;
    }
  },
);
