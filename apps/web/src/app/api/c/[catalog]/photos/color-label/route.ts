import { NextResponse } from "next/server";
import { setColorLabelSchema } from "@lumio/shared";
import { setPhotoColorLabel } from "@/lib/photos-service";
import { withCatalog } from "@/lib/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withCatalog(async (request, _context, { catalog }) => {
  const body: unknown = await request.json();
  const parsed = setColorLabelSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const count = await setPhotoColorLabel(catalog.id, parsed.data.photoIds, parsed.data.label);
  return NextResponse.json({ status: "labeled", count });
});
