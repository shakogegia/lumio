import { NextResponse } from "next/server";
import { editPhotoSchema } from "@lumio/shared";
import { applyPhotoEdits } from "@/lib/photo-edits-service";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withAuth(
  async (request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const parsed = editPhotoSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid edit recipe" }, { status: 400 });
    }
    const dto = await applyPhotoEdits(id, parsed.data.edits);
    if (!dto) return NextResponse.json({ error: "Photo not found" }, { status: 404 });
    return NextResponse.json(dto);
  },
);
