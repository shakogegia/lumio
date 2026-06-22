import { NextResponse } from "next/server";
import { photosQuerySchema } from "@lumio/shared";
import { listTrash } from "@/lib/trash-service";
import { withCatalog } from "@/lib/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withCatalog(async (request, _context, { catalog }) => {
  const { searchParams } = new URL(request.url);
  const parsed = photosQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const page = await listTrash(catalog.id, parsed.data);
  return NextResponse.json(page);
});
