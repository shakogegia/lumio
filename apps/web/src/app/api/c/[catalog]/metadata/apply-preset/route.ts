// apps/web/src/app/api/c/[catalog]/metadata/apply-preset/route.ts
import { NextResponse } from "next/server";
import { FeatureKey, getPreset } from "@lumio/shared";
import { applyMetadataPreset, getCatalogSchema, isFeatureEnabled } from "@lumio/db";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withCatalog(async (request, _context, { catalog }) => {
  if (!(await isFeatureEnabled(catalog.id, FeatureKey.Metadata))) {
    return NextResponse.json({ error: "Metadata feature disabled" }, { status: 404 });
  }
  const body = (await request.json().catch(() => null)) as { presetId?: string } | null;
  const preset = body?.presetId ? getPreset(body.presetId) : undefined;
  if (!preset) return NextResponse.json({ error: "Unknown preset" }, { status: 400 });

  const existing = await getCatalogSchema(catalog.id);
  if (existing.length > 0) {
    return NextResponse.json({ error: "Schema is not empty" }, { status: 409 });
  }
  await applyMetadataPreset(catalog.id, preset);
  return NextResponse.json({ schema: await getCatalogSchema(catalog.id) }, { status: 201 });
});
