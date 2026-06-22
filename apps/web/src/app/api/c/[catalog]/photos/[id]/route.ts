import { NextResponse } from "next/server";
import { getPhoto } from "@/lib/photos-service";
import { withCatalog } from "@/lib/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withCatalog<{ id: string }>(async (_request, context, { catalog }) => {
  const { id } = await context.params;
  const photo = await getPhoto(catalog.id, id);
  if (!photo) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }
  return NextResponse.json(photo);
});
