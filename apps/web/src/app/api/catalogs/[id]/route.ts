import { NextResponse } from "next/server";
import { applyCatalogPositions, listCatalogs, renameCatalog } from "@lumio/db";
import { computeReorder } from "@lumio/shared";
import { withAuth } from "@/lib/with-auth";
import { deleteCatalogWithMode, type DeleteMode } from "@/lib/catalog-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PATCH = withAuth(async (request, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  const body = (await request.json()) as { name?: string; afterId?: string | null };

  // Reorder: present (even when null) `afterId` means "move after this catalog".
  if ("afterId" in body) {
    const catalogs = await listCatalogs();
    if (!catalogs.some((c) => c.id === id)) {
      return NextResponse.json({ error: "Catalog not found" }, { status: 404 });
    }
    const items = catalogs.map((c) => ({ id: c.id, position: c.position }));
    const updates = computeReorder(items, id, body.afterId ?? null);
    await applyCatalogPositions(updates);
    return NextResponse.json({ ok: true });
  }

  // Rename (unchanged).
  const name = (body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  const catalog = await renameCatalog(id, name);
  return NextResponse.json({ catalog });
});

export const DELETE = withAuth(async (request, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  const url = new URL(request.url);
  const mode = (url.searchParams.get("mode") ?? "detach") as DeleteMode;
  await deleteCatalogWithMode(id, mode);
  return NextResponse.json({ ok: true });
});
