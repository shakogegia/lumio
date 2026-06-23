import { NextResponse } from "next/server";
import { prisma } from "@lumio/db";
import { purgeTrash } from "@lumio/jobs";
import { photoIdsSchema } from "@lumio/shared";
import { catalogTrashDir } from "@/lib/server/server-paths";
import { parseJson } from "@/lib/server/route-helpers";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withCatalog(async (request, _context, { catalog }) => {
  const parsed = await parseJson(request, photoIdsSchema);
  if ("response" in parsed) return parsed.response;
  const result = await purgeTrash(parsed.data.ids, {
    db: prisma,
    catalogId: catalog.id,
    trashDir: catalogTrashDir(catalog.id),
  });
  return NextResponse.json(result);
});
