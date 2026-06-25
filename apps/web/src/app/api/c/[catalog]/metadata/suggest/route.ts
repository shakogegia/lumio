// apps/web/src/app/api/c/[catalog]/metadata/suggest/route.ts
import { NextResponse } from "next/server";
import { FeatureKey } from "@lumio/shared";
import { isFeatureEnabled, suggestFieldValues } from "@lumio/db";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withCatalog(async (request, _context, { catalog }) => {
  if (!(await isFeatureEnabled(catalog.id, FeatureKey.Metadata))) {
    return NextResponse.json({ values: [] });
  }
  const url = new URL(request.url);
  const field = url.searchParams.get("field");
  const q = url.searchParams.get("q") ?? "";
  if (!field) return NextResponse.json({ error: "field is required" }, { status: 400 });
  return NextResponse.json({ values: await suggestFieldValues(field, q) });
});
