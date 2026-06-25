// apps/web/src/app/api/c/[catalog]/metadata/schema/route.ts
import { NextResponse } from "next/server";
import { FeatureKey } from "@lumio/shared";
import { getCatalogSchema, isFeatureEnabled } from "@lumio/db";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withCatalog(async (_request, _context, { catalog }) => {
  if (!(await isFeatureEnabled(catalog.id, FeatureKey.Metadata))) {
    return NextResponse.json({ error: "Metadata feature disabled" }, { status: 404 });
  }
  return NextResponse.json({ schema: await getCatalogSchema(catalog.id) });
});
