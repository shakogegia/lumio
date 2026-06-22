import { NextResponse } from "next/server";
import { photosQuerySchema } from "@lumio/shared";
import { listFolderPhotos } from "@/lib/folders-service";
import { withCatalog } from "@/lib/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withCatalog<{ id: string }>(async (request, context, { catalog }) => {
  const { id } = await context.params;
  const { searchParams } = new URL(request.url);
  const parsed = photosQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const page = await listFolderPhotos(catalog.id, id, parsed.data);
  if (!page) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  return NextResponse.json(page);
});
