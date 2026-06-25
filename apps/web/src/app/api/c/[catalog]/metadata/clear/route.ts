// apps/web/src/app/api/c/[catalog]/metadata/clear/route.ts
import { NextResponse } from "next/server";
import { FeatureKey } from "@lumio/shared";
import { clearCatalogSchema, isFeatureEnabled } from "@lumio/db";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withCatalog(async (_request, _context, { catalog }) => {
  if (!(await isFeatureEnabled(catalog.id, FeatureKey.Metadata))) {
    return NextResponse.json({ error: "Metadata feature disabled" }, { status: 404 });
  }
  await clearCatalogSchema(catalog.id);
  return NextResponse.json({ ok: true });
});
