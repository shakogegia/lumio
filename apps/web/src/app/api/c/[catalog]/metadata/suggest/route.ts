// apps/web/src/app/api/c/[catalog]/metadata/suggest/route.ts
import { NextResponse } from "next/server";
import { FeatureKey } from "@lumio/shared";
import { getCatalogSchema, isFeatureEnabled, suggestFieldValues } from "@lumio/db";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withCatalog(async (request, _context, { catalog }) => {
  if (!(await isFeatureEnabled(catalog.id, FeatureKey.Metadata))) {
    return NextResponse.json({ error: "Metadata feature disabled" }, { status: 404 });
  }
  const url = new URL(request.url);
  const field = url.searchParams.get("field");
  const q = url.searchParams.get("q") ?? "";
  if (!field) return NextResponse.json({ error: "field is required" }, { status: 400 });
  // Validate the field belongs to this catalog — don't enumerate values for foreign fields.
  const schema = await getCatalogSchema(catalog.id);
  const known = schema.some((g) => g.fields.some((f) => f.id === field));
  if (!known) return NextResponse.json({ values: [] });
  return NextResponse.json({ values: await suggestFieldValues(field, q) });
});
