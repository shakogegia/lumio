import { NextResponse } from "next/server";
import { createShareLinkSchema } from "@lumio/shared";
import { withCatalog } from "@/lib/server/with-catalog";
import { parseJson, errorJson, mapServiceError } from "@/lib/server/route-helpers";
import { getPublicBaseUrl } from "@/lib/server/app-settings-service";
import { createShareLink, listShareLinks } from "@/lib/server/share-links-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withCatalog(async (_request, _context, { catalog }) => {
  const baseUrl = (await getPublicBaseUrl()) ?? "";
  const items = await listShareLinks(catalog.id, baseUrl);
  return NextResponse.json({ items });
});

export const POST = withCatalog(async (request, _context, { catalog }) => {
  const parsed = await parseJson(request, createShareLinkSchema);
  if ("response" in parsed) return parsed.response;
  const baseUrl = await getPublicBaseUrl();
  if (!baseUrl) {
    return errorJson("Set your Public base URL in Settings → General first", 400, { code: "no_base_url" });
  }
  try {
    const link = await createShareLink(catalog.id, parsed.data, { baseUrl });
    return NextResponse.json(link, { status: 201 });
  } catch (err) {
    const mapped = mapServiceError(err);
    if (mapped) return mapped;
    throw err;
  }
});
