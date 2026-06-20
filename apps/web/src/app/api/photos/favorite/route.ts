import { NextResponse } from "next/server";
import { setFavoriteSchema } from "@lumio/shared";
import { setPhotoFavorite } from "@/lib/photos-service";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withAuth(async (request) => {
  const body: unknown = await request.json();
  const parsed = setFavoriteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const count = await setPhotoFavorite(parsed.data.photoIds, parsed.data.isFavorite);
  return NextResponse.json({ status: "favorited", count });
});
