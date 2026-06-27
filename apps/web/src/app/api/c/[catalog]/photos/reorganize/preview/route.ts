import { NextResponse } from "next/server";
import { prisma } from "@lumio/db";
import { previewReorganize } from "@lumio/jobs";
import { validateTemplate } from "@lumio/shared";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withCatalog(async (request, _context, { catalog }) => {
  const check = validateTemplate(catalog.uploadTemplate);
  if (!check.ok) {
    return NextResponse.json({ error: `Invalid upload template: ${check.error}` }, { status: 400 });
  }
  const includeFilesystem =
    new URL(request.url).searchParams.get("includeFilesystem") === "true";
  const result = await previewReorganize({
    db: prisma,
    catalogId: catalog.id,
    uploadTemplate: catalog.uploadTemplate,
    includeFilesystem,
  });
  return NextResponse.json(result);
});
