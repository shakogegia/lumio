import { NextResponse } from "next/server";
import { withCatalog } from "@/lib/server/with-catalog";
import { mapServiceError } from "@/lib/server/route-helpers";
import { deleteShareLinkChecked } from "@/lib/server/share-links-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = withCatalog<{ id: string }>(async (_request, context, { catalog }) => {
  const { id } = await context.params;
  try {
    await deleteShareLinkChecked(catalog.id, id);
  } catch (err) {
    const mapped = mapServiceError(err);
    if (mapped) return mapped;
    throw err;
  }
  return new NextResponse(null, { status: 204 });
});
