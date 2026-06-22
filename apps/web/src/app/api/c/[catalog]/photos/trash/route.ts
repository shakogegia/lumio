import path from "node:path";
import { NextResponse } from "next/server";
import { prisma } from "@lumio/db";
import { photoIdsSchema } from "@lumio/shared";
import { trashPhotos } from "@/lib/trash-service";
import { CACHE_DIR, TRASH_DIR } from "@/lib/paths";
import { withCatalog } from "@/lib/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withCatalog(async (request, _context, { catalog }) => {
  const body: unknown = await request.json();
  const parsed = photoIdsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const result = await trashPhotos(parsed.data.ids, {
    db: prisma,
    catalogId: catalog.id,
    photosDir: catalog.path,
    cacheDir: path.join(CACHE_DIR, catalog.id),
    trashDir: path.join(TRASH_DIR, catalog.id),
  });
  return NextResponse.json(result);
});
