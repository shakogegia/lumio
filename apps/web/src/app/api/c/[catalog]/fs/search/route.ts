import { NextResponse } from "next/server";
import { isFeatureEnabled } from "@lumio/db";
import { FeatureKey } from "@lumio/shared";
import { withCatalog } from "@/lib/with-catalog";
import { searchCatalogTree } from "@/lib/catalog-fs-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Recursively search a catalog's folders/files by name under `?path=<rel>`
 * (default root) for `?q=<query>`. Gated by the disk-explorer feature.
 */
export const GET = withCatalog(async (request, _context, { catalog }) => {
  if (!(await isFeatureEnabled(catalog.id, FeatureKey.DiskExplorer))) {
    return new Response("Not found", { status: 404 });
  }
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const rel = url.searchParams.get("path") ?? "";
  if (q.trim() === "") {
    return NextResponse.json({ dirs: [], files: [], truncated: false });
  }
  try {
    return NextResponse.json(await searchCatalogTree(catalog, rel, q));
  } catch {
    return new Response("Invalid path", { status: 400 });
  }
});
