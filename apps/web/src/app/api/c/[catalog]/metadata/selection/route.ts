import { NextResponse } from "next/server";
import { FeatureKey } from "@lumio/shared";
import {
  aggregatePhotoMetadataValues,
  bulkUpsertPhotoMetadataField,
  getCatalogSchema,
  isFeatureEnabled,
} from "@lumio/db";
import { withCatalog } from "@/lib/server/with-catalog";
import { filterCatalogPhotoIds } from "@/lib/server/photos-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readPhotoIds(input: unknown): string[] {
  return Array.isArray(input) ? input.filter((id): id is string => typeof id === "string") : [];
}

/**
 * Load the per-field aggregated metadata for a selection of photos: each field's
 * shared value, or `{ mixed: true }` when the selected photos disagree. Powers
 * the selection-bound upload editor.
 */
export const POST = withCatalog(async (request, _context, { catalog }) => {
  if (!(await isFeatureEnabled(catalog.id, FeatureKey.Metadata))) {
    return NextResponse.json({ error: "Metadata feature disabled" }, { status: 404 });
  }
  const body = (await request.json().catch(() => null)) as { photoIds?: unknown } | null;
  const photoIds = readPhotoIds(body?.photoIds);
  if (photoIds.length === 0) {
    return NextResponse.json({ error: "photoIds must be a non-empty array" }, { status: 400 });
  }
  if (photoIds.length > 5000) {
    return NextResponse.json({ error: "too many photoIds" }, { status: 400 });
  }
  const owned = await filterCatalogPhotoIds(catalog.id, photoIds);
  if (owned.length === 0) return NextResponse.json({ values: {} });
  const agg = await aggregatePhotoMetadataValues(owned);
  return NextResponse.json({ values: Object.fromEntries(agg) });
});

/** Set (or clear, when empty) one field's value across the whole selection. */
export const PUT = withCatalog(async (request, _context, { catalog }) => {
  if (!(await isFeatureEnabled(catalog.id, FeatureKey.Metadata))) {
    return NextResponse.json({ error: "Metadata feature disabled" }, { status: 404 });
  }
  const body = (await request.json().catch(() => null)) as
    | { photoIds?: unknown; fieldId?: unknown; value?: unknown }
    | null;
  const photoIds = readPhotoIds(body?.photoIds);
  if (photoIds.length === 0) {
    return NextResponse.json({ error: "photoIds must be a non-empty array" }, { status: 400 });
  }
  if (photoIds.length > 5000) {
    return NextResponse.json({ error: "too many photoIds" }, { status: 400 });
  }
  if (typeof body?.fieldId !== "string" || typeof body.value !== "string") {
    return NextResponse.json({ error: "fieldId and value are required" }, { status: 400 });
  }
  // Only allow writing fields that belong to this catalog.
  const schema = await getCatalogSchema(catalog.id);
  const known = schema.some((g) => g.fields.some((f) => f.id === body.fieldId));
  if (!known) return NextResponse.json({ error: "Unknown field" }, { status: 400 });

  // Only operate on photos owned by this catalog — drop any foreign ids.
  const owned = await filterCatalogPhotoIds(catalog.id, photoIds);
  if (owned.length === 0) return NextResponse.json({ ok: true });
  await bulkUpsertPhotoMetadataField(owned, body.fieldId, body.value);
  return NextResponse.json({ ok: true });
});
