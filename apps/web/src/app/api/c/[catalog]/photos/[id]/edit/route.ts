import { NextResponse } from "next/server";
import { editPhotoSchema } from "@lumio/shared";
import { applyPhotoEdits } from "@/lib/photo-edits-service";
import { withCatalog } from "@/lib/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withCatalog<{ id: string }>(async (request, context, { catalog }) => {
  const { id } = await context.params;
  const parsed = editPhotoSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid edit recipe" }, { status: 400 });
  }
  const dto = await applyPhotoEdits(catalog, id, parsed.data.edits);
  if (!dto) return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  return NextResponse.json(dto);
});
