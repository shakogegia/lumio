import { NextResponse } from "next/server";
import { type Prisma, isFeatureEnabled } from "@lumio/db";
import { coercePhotoSort, FeatureKey, monthParamSchema, monthRange } from "@lumio/shared";
import { withCatalog } from "@/lib/with-catalog";
import { listPhotosForWhere } from "@/lib/photos-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Offset-paginated photos that live directly in directory `?path=<rel>` (default
 * root), ordered by `?sort=<PhotoSort>` (the standard photo sort). Backs the
 * disk-folder lightbox film strip so it shows only the folder's siblings.
 * Membership is the indexed `Photo.dirPath` column (no filesystem scan).
 * Gated by the disk-explorer feature.
 */
export const GET = withCatalog(async (request, _context, { catalog }) => {
  if (!(await isFeatureEnabled(catalog.id, FeatureKey.DiskExplorer))) {
    return new Response("Not found", { status: 404 });
  }
  const { searchParams } = new URL(request.url);
  const dir = searchParams.get("path") ?? "";
  const sort = coercePhotoSort(searchParams.get("sort") ?? undefined);
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 50));
  const offset = Math.max(0, Number(searchParams.get("offset")) || 0);

  // Direct membership: the folder's OWN photos. An optional ?month filter narrows
  // by sortDate (same as the library/album calendar); an invalid month is ignored.
  const where: Prisma.PhotoWhereInput = { dirPath: dir };
  const month = monthParamSchema.safeParse(searchParams.get("month") ?? undefined);
  if (month.success) where.sortDate = monthRange(month.data);

  const page = await listPhotosForWhere(catalog.id, where, { limit, offset, sort });
  return NextResponse.json(page);
});
