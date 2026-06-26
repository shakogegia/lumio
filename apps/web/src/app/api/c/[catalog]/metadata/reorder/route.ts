// apps/web/src/app/api/c/[catalog]/metadata/reorder/route.ts
import { NextResponse } from "next/server";
import { FeatureKey } from "@lumio/shared";
import {
  getCatalogSchema,
  isFeatureEnabled,
  reorderMetadataField,
  reorderMetadataGroup,
} from "@lumio/db";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withCatalog(async (request, _context, { catalog }) => {
  if (!(await isFeatureEnabled(catalog.id, FeatureKey.Metadata)))
    return NextResponse.json({ error: "disabled" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as
    | { kind?: string; movedId?: string; afterId?: string | null }
    | null;
  if (!body?.movedId || (body.kind !== "field" && body.kind !== "group")) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const afterId = typeof body.afterId === "string" ? body.afterId : null;
  const schema = await getCatalogSchema(catalog.id);

  if (body.kind === "group") {
    if (!schema.some((g) => g.id === body.movedId)) return NextResponse.json({ error: "unknown" }, { status: 404 });
    await reorderMetadataGroup(catalog.id, body.movedId, afterId);
    return NextResponse.json({ ok: true });
  }

  // field: find its group (and confirm ownership)
  const group = schema.find((g) => g.fields.some((f) => f.id === body.movedId));
  if (!group) return NextResponse.json({ error: "unknown" }, { status: 404 });
  await reorderMetadataField(group.id, body.movedId, afterId);
  return NextResponse.json({ ok: true });
});
