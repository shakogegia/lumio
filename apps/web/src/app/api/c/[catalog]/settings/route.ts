import { NextResponse } from "next/server";
import { prisma } from "@lumio/db";
import { validateTemplate } from "@lumio/shared";
import { withCatalog } from "@/lib/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withCatalog(async (_request, _context, { catalog }) => {
  return NextResponse.json({ uploadTemplate: catalog.uploadTemplate });
});

export const PUT = withCatalog(async (request, _context, { catalog }) => {
  const body: unknown = await request.json();
  if (typeof body !== "object" || body === null || !("uploadTemplate" in body)) {
    return NextResponse.json({ error: "uploadTemplate is required" }, { status: 400 });
  }
  const { uploadTemplate } = body as { uploadTemplate: unknown };
  if (typeof uploadTemplate !== "string") {
    return NextResponse.json({ error: "uploadTemplate must be a string" }, { status: 400 });
  }
  const validation = validateTemplate(uploadTemplate);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const updated = await prisma.catalog.update({
    where: { id: catalog.id },
    data: { uploadTemplate },
  });
  return NextResponse.json({ uploadTemplate: updated.uploadTemplate });
});
