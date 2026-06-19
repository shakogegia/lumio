import { NextResponse } from "next/server";
import { searchQuerySchema } from "@lumio/shared";
import { searchPhotos } from "@/lib/search-service";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (request) => {
  const { searchParams } = new URL(request.url);
  // `album` may repeat; getAll preserves every value (Object.fromEntries keeps only the last).
  const parsed = searchQuerySchema.safeParse({
    ...Object.fromEntries(searchParams),
    album: searchParams.getAll("album"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const page = await searchPhotos(parsed.data);
  return NextResponse.json(page);
});
