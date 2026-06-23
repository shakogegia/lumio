import { NextResponse } from "next/server";
import {
  FeatureScopeError,
  UnknownFeatureError,
  setFeature,
  getCatalogById,
} from "@lumio/db";
import { FeatureKey } from "@lumio/shared";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_KEYS = new Set<string>(Object.values(FeatureKey));

/** Toggle one feature. Body: { key, catalogId: string | null, enabled: boolean }. */
export const PUT = withAuth(async (request) => {
  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { key, catalogId, enabled } = body as {
    key?: unknown;
    catalogId?: unknown;
    enabled?: unknown;
  };
  if (typeof key !== "string" || !VALID_KEYS.has(key)) {
    return NextResponse.json({ error: "Unknown feature key" }, { status: 400 });
  }
  if (!(catalogId === null || typeof catalogId === "string")) {
    return NextResponse.json({ error: "catalogId must be a string or null" }, { status: 400 });
  }
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }
  if (catalogId !== null) {
    const catalog = await getCatalogById(catalogId);
    if (!catalog) {
      return NextResponse.json({ error: "Catalog not found" }, { status: 404 });
    }
  }
  try {
    await setFeature({ key: key as FeatureKey, catalogId, enabled });
  } catch (e) {
    if (e instanceof FeatureScopeError || e instanceof UnknownFeatureError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
  return NextResponse.json({ ok: true });
});
