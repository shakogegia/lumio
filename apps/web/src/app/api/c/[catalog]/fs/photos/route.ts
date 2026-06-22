import { NextResponse } from "next/server";
import { isFeatureEnabled } from "@lumio/db";
import { FeatureKey } from "@lumio/shared";
import { withCatalog } from "@/lib/with-catalog";
import { parseFolderSortParam } from "@/lib/catalog-fs";
import { folderPhotoOrderBy } from "@/lib/photo-order";
import { listPhotosForWhere } from "@/lib/photos-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Offset-paginated photos that live directly in directory `?path=<rel>` (default
 * root), ordered by `?fsort=<field:dir>` (the folders view's name/date sort).
 * Backs the disk-folder lightbox film strip so it shows only the folder's
 * siblings. Membership is the indexed `Photo.dirPath` column (no filesystem
 * scan). Gated by the disk-explorer feature.
 */
export const GET = withCatalog(async (request, _context, { catalog }) => {
  if (!(await isFeatureEnabled(catalog.id, FeatureKey.DiskExplorer))) {
    return new Response("Not found", { status: 404 });
  }
  const { searchParams } = new URL(request.url);
  const dir = searchParams.get("path") ?? "";
  const fsort = parseFolderSortParam(searchParams.get("fsort"));
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 50));
  const offset = Math.max(0, Number(searchParams.get("offset")) || 0);

  const page = await listPhotosForWhere(
    catalog.id,
    { dirPath: dir },
    { limit, offset, orderBy: folderPhotoOrderBy(fsort) },
  );
  return NextResponse.json(page);
});
