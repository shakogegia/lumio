import { NextResponse } from "next/server";
import { FeatureKey } from "@lumio/shared";
import { bulkSetPhotoMetadataValues, getCatalogSchema, isFeatureEnabled } from "@lumio/db";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withCatalog(async (request, _context, { catalog }) => {
  if (!(await isFeatureEnabled(catalog.id, FeatureKey.Metadata))) {
    return NextResponse.json({ error: "Metadata feature disabled" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as
    | { photoIds?: unknown; values?: unknown }
    | null;

  const photoIds = body?.photoIds;
  if (!Array.isArray(photoIds) || photoIds.length === 0) {
    return NextResponse.json({ error: "photoIds must be a non-empty array" }, { status: 400 });
  }

  const rawValues = body?.values;
  const values = Array.isArray(rawValues)
    ? (rawValues as Array<{ fieldId?: unknown; value?: unknown }>).filter(
        (v): v is { fieldId: string; value: string } =>
          typeof v.fieldId === "string" && typeof v.value === "string",
      )
    : [];

  // Only allow writing fields that belong to this catalog.
  const schema = await getCatalogSchema(catalog.id);
  const knownFieldIds = new Set(schema.flatMap((g) => g.fields.map((f) => f.id)));
  const filtered = values.filter((v) => knownFieldIds.has(v.fieldId));

  await bulkSetPhotoMetadataValues(
    photoIds.filter((id): id is string => typeof id === "string"),
    filtered,
  );

  return NextResponse.json({ ok: true });
});
