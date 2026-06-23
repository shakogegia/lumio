import { NextResponse } from "next/server";
import { setColorLabelSchema } from "@lumio/shared";
import { setPhotoColorLabel } from "@/lib/server/photos-service";
import { parseJson } from "@/lib/server/route-helpers";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withCatalog(async (request, _context, { catalog }) => {
  const parsed = await parseJson(request, setColorLabelSchema);
  if ("response" in parsed) return parsed.response;
  const count = await setPhotoColorLabel(catalog.id, parsed.data.photoIds, parsed.data.label);
  return NextResponse.json({ status: "labeled", count });
});
