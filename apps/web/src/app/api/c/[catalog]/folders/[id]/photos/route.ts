import { NextResponse } from "next/server";
import { photosQuerySchema } from "@lumio/shared";
import { listFolderPhotos } from "@/lib/server/folders-service";
import { parseQuery } from "@/lib/server/route-helpers";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withCatalog<{ id: string }>(async (request, context, { catalog }) => {
  const { id } = await context.params;
  const parsed = parseQuery(request, photosQuerySchema);
  if ("response" in parsed) return parsed.response;
  const page = await listFolderPhotos(catalog.id, id, parsed.data);
  if (!page) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  return NextResponse.json(page);
});
