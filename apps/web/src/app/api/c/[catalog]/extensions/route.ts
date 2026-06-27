import { NextResponse } from "next/server";
import { distinctExtensions } from "@lumio/db";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Distinct file extensions present in the catalog — options for the "File type"
// search facet. Not behind the Metadata feature flag: extension is a core file
// fact, always available.
export const GET = withCatalog(async (_request, _context, { catalog }) => {
  return NextResponse.json({ extensions: await distinctExtensions(catalog.id) });
});
