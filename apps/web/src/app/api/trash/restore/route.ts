import { NextResponse } from "next/server";
import { photoIdsSchema } from "@lumio/shared";
import { restorePhotos } from "@/lib/trash-service";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withAuth(async (request) => {
  const body: unknown = await request.json();
  const parsed = photoIdsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const result = await restorePhotos(parsed.data.ids);
  return NextResponse.json(result);
});
