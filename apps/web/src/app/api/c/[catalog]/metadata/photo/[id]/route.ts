// apps/web/src/app/api/c/[catalog]/metadata/photo/[id]/route.ts
import { NextResponse } from "next/server";
import { FeatureKey, resolvePhotoMetadata } from "@lumio/shared";
import {
  getCatalogSchema,
  getPhotoMetadataValues,
  isFeatureEnabled,
  upsertPhotoMetadataValue,
} from "@lumio/db";
import { getPhoto } from "@/lib/server/photos-service";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withCatalog<{ id: string }>(async (_request, context, { catalog }) => {
  if (!(await isFeatureEnabled(catalog.id, FeatureKey.Metadata))) {
    return NextResponse.json({ error: "Metadata feature disabled" }, { status: 404 });
  }
  const { id } = await context.params;
  const photo = await getPhoto(catalog.id, id);
  if (!photo) return NextResponse.json({ error: "Photo not found" }, { status: 404 });

  const [schema, values] = await Promise.all([
    getCatalogSchema(catalog.id),
    getPhotoMetadataValues(id),
  ]);
  return NextResponse.json({ groups: resolvePhotoMetadata(schema, values, photo.exif) });
});

export const PUT = withCatalog<{ id: string }>(async (request, context, { catalog }) => {
  if (!(await isFeatureEnabled(catalog.id, FeatureKey.Metadata))) {
    return NextResponse.json({ error: "Metadata feature disabled" }, { status: 404 });
  }
  const { id } = await context.params;
  const photo = await getPhoto(catalog.id, id);
  if (!photo) return NextResponse.json({ error: "Photo not found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as
    | { fieldId?: string; value?: string }
    | null;
  if (!body?.fieldId || typeof body.value !== "string") {
    return NextResponse.json({ error: "fieldId and value are required" }, { status: 400 });
  }
  // Only allow writing fields that belong to this catalog.
  const schema = await getCatalogSchema(catalog.id);
  const known = schema.some((g) => g.fields.some((f) => f.id === body.fieldId));
  if (!known) return NextResponse.json({ error: "Unknown field" }, { status: 400 });

  await upsertPhotoMetadataValue(id, body.fieldId, body.value);
  return NextResponse.json({ ok: true });
});
