// apps/web/src/app/api/c/[catalog]/metadata/groups/route.ts
import { NextResponse } from "next/server";
import { FeatureKey } from "@lumio/shared";
import { createMetadataGroup, isFeatureEnabled } from "@lumio/db";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withCatalog(async (request, _context, { catalog }) => {
  if (!(await isFeatureEnabled(catalog.id, FeatureKey.Metadata)))
    return NextResponse.json({ error: "disabled" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { label?: string } | null;
  const label = body?.label?.trim();
  if (!label) return NextResponse.json({ error: "label required" }, { status: 400 });
  const group = await createMetadataGroup(catalog.id, label);
  return NextResponse.json({ id: group.id }, { status: 201 });
});
