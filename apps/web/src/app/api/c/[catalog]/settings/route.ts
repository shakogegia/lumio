import { NextResponse } from "next/server";
import { setUploadTemplate } from "@lumio/db";
import { updateCatalogSettingsSchema, validateTemplate } from "@lumio/shared";
import { withCatalog } from "@/lib/server/with-catalog";
import { parseJson } from "@/lib/server/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withCatalog(async (_request, _context, { catalog }) => {
  return NextResponse.json({ uploadTemplate: catalog.uploadTemplate });
});

export const PUT = withCatalog(async (request, _context, { catalog }) => {
  const parsed = await parseJson(request, updateCatalogSettingsSchema);
  if ("response" in parsed) return parsed.response;
  const { uploadTemplate } = parsed.data;
  const validation = validateTemplate(uploadTemplate);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const updated = await setUploadTemplate(catalog.id, uploadTemplate);
  return NextResponse.json({ uploadTemplate: updated.uploadTemplate });
});
