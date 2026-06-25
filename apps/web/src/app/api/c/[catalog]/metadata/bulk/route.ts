import { NextResponse } from "next/server";
import { FeatureKey } from "@lumio/shared";
import { bulkSetPhotoMetadataValues, getCatalogSchema, isFeatureEnabled } from "@lumio/db";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withCatalog(async (request, _context, { catalog }) => {
  if (!(await isFeatureEnabled(catalog.id, FeatureKey.Metadata)))
    return NextResponse.json({ error: "disabled" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as
    | { photoIds?: unknown; values?: unknown }
    | null;
  const photoIds = Array.isArray(body?.photoIds)
    ? body!.photoIds.filter((p): p is string => typeof p === "string")
    : [];
  const rawValues = Array.isArray(body?.values) ? body!.values : [];
  if (photoIds.length === 0) return NextResponse.json({ error: "no photos" }, { status: 400 });

  // Only accept values for fields that belong to this catalog.
  const schema = await getCatalogSchema(catalog.id);
  const known = new Set(schema.flatMap((g) => g.fields.map((f) => f.id)));
  const values = (rawValues as Array<{ fieldId?: unknown; value?: unknown }>)
    .filter((v) => typeof v.fieldId === "string" && known.has(v.fieldId) && typeof v.value === "string")
    .map((v) => ({ fieldId: v.fieldId as string, value: v.value as string }));

  await bulkSetPhotoMetadataValues(photoIds, values);
  return NextResponse.json({ ok: true });
});
