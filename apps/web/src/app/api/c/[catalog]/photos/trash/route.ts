import { NextResponse } from "next/server";
import { prisma } from "@lumio/db";
import { photoIdsSchema } from "@lumio/shared";
import { trashPhotos } from "@/lib/trash-service";
import { catalogCacheDir, catalogTrashDir } from "@/lib/paths";
import { parseJson } from "@/lib/route-helpers";
import { withCatalog } from "@/lib/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withCatalog(async (request, _context, { catalog }) => {
  const parsed = await parseJson(request, photoIdsSchema);
  if ("response" in parsed) return parsed.response;
  const result = await trashPhotos(parsed.data.ids, {
    db: prisma,
    catalogId: catalog.id,
    photosDir: catalog.path,
    cacheDir: catalogCacheDir(catalog.id),
    trashDir: catalogTrashDir(catalog.id),
  });
  return NextResponse.json(result);
});
