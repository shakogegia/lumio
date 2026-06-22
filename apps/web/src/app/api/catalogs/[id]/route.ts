import { NextResponse } from "next/server";
import { renameCatalog } from "@lumio/db";
import { withAuth } from "@/lib/with-auth";
import { deleteCatalogWithMode, type DeleteMode } from "@/lib/catalog-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PATCH = withAuth(async (request, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  const body = (await request.json()) as { name?: string };
  const catalog = await renameCatalog(id, body.name ?? "");
  return NextResponse.json({ catalog });
});

export const DELETE = withAuth(async (request, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  const url = new URL(request.url);
  const mode = (url.searchParams.get("mode") ?? "detach") as DeleteMode;
  await deleteCatalogWithMode(id, mode);
  return NextResponse.json({ ok: true });
});
