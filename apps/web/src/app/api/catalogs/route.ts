import { NextResponse } from "next/server";
import { listCatalogs } from "@lumio/db";
import { withAuth } from "@/lib/with-auth";
import { createCatalogChecked } from "@/lib/catalog-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async () => {
  const catalogs = await listCatalogs();
  return NextResponse.json(catalogs);
});

export const POST = withAuth(async (request) => {
  const body: unknown = await request.json();
  const result = await createCatalogChecked(body as { name: string; path: string });
  if (result.ok === false) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ catalog: result.catalog }, { status: 201 });
});
