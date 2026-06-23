import { NextResponse } from "next/server";
import {
  getCatalogById,
  setFeature,
} from "@lumio/db";
import { featureToggleSchema } from "@lumio/shared";
import { withAuth } from "@/lib/server/with-auth";
import { parseJson, mapServiceError } from "@/lib/server/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Toggle one feature. Body: { key, catalogId: string | null, enabled: boolean }. */
export const PUT = withAuth(async (request) => {
  const parsed = await parseJson(request, featureToggleSchema);
  if ("response" in parsed) return parsed.response;
  const { key, catalogId, enabled } = parsed.data;
  if (catalogId !== null) {
    const catalog = await getCatalogById(catalogId);
    if (!catalog) {
      return NextResponse.json({ error: "Catalog not found" }, { status: 404 });
    }
  }
  try {
    await setFeature({ key, catalogId, enabled });
  } catch (err) {
    const mapped = mapServiceError(err);
    if (mapped) return mapped;
    throw err;
  }
  return NextResponse.json({ ok: true });
});
