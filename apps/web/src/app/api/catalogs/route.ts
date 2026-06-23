import { NextResponse } from "next/server";
import { listCatalogs } from "@lumio/db";
import { createCatalogSchema } from "@lumio/shared";
import { withAuth } from "@/lib/server/with-auth";
import { createCatalogChecked } from "@/lib/server/catalog-service";
import { parseJson } from "@/lib/server/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async () => {
  const catalogs = await listCatalogs();
  return NextResponse.json(catalogs);
});

export const POST = withAuth(async (request) => {
  const parsed = await parseJson(request, createCatalogSchema);
  if ("response" in parsed) return parsed.response;
  const result = await createCatalogChecked(parsed.data);
  if (result.ok === false) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ catalog: result.catalog }, { status: 201 });
});
