// apps/web/src/app/api/c/[catalog]/metadata/fields/route.ts
import { NextResponse } from "next/server";
import { FeatureKey, FieldType } from "@lumio/shared";
import { createMetadataField, getCatalogSchema, isFeatureEnabled } from "@lumio/db";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES = new Set<string>(Object.values(FieldType));

export const POST = withCatalog(async (request, _context, { catalog }) => {
  if (!(await isFeatureEnabled(catalog.id, FeatureKey.Metadata)))
    return NextResponse.json({ error: "disabled" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as
    | { groupId?: string; label?: string; type?: string; options?: unknown[] }
    | null;
  const label = body?.label?.trim();
  const type = body?.type ?? FieldType.Text;
  if (!body?.groupId || !label) return NextResponse.json({ error: "groupId and label required" }, { status: 400 });
  if (!TYPES.has(type)) return NextResponse.json({ error: "bad type" }, { status: 400 });
  const options = Array.isArray(body?.options) ? body!.options.filter((o): o is string => typeof o === "string" && o.trim() !== "") : [];
  const schema = await getCatalogSchema(catalog.id);
  if (!schema.some((g) => g.id === body.groupId))
    return NextResponse.json({ error: "unknown group" }, { status: 400 });
  const field = await createMetadataField(catalog.id, body.groupId, label, type, options);
  return NextResponse.json({ id: field.id }, { status: 201 });
});
