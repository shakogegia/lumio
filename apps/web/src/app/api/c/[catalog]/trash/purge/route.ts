import { NextResponse } from "next/server";
import { prisma } from "@lumio/db";
import { purgePendingPhotos, purgeTrash } from "@lumio/jobs";
import { photoIdsSchema } from "@lumio/shared";
import { catalogCacheDir, catalogTrashDir } from "@/lib/server/server-paths";
import { parseJson } from "@/lib/server/route-helpers";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withCatalog(async (request, _context, { catalog }) => {
  const parsed = await parseJson(request, photoIdsSchema);
  if ("response" in parsed) return parsed.response;
  const ids = parsed.data.ids;
  const finalized = await purgeTrash(ids, { db: prisma, catalogId: catalog.id, trashDir: catalogTrashDir(catalog.id) });
  const pending = await purgePendingPhotos(ids, {
    db: prisma, catalogId: catalog.id, photosDir: catalog.path, cacheDir: catalogCacheDir(catalog.id),
  });
  return NextResponse.json({ deleted: finalized.deleted + pending.deleted });
});
