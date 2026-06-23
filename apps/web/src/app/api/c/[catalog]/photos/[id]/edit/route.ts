import { NextResponse } from "next/server";
import { editPhotoSchema } from "@lumio/shared";
import { applyPhotoEdits } from "@/features/photo-editor/server/photo-edits-service";
import { parseJson } from "@/lib/server/route-helpers";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withCatalog<{ id: string }>(async (request, context, { catalog }) => {
  const { id } = await context.params;
  const parsed = await parseJson(request, editPhotoSchema);
  if ("response" in parsed) return parsed.response;
  const dto = await applyPhotoEdits(catalog, id, parsed.data.edits);
  if (!dto) return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  return NextResponse.json(dto);
});
