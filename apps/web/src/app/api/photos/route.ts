import { NextResponse } from "next/server";
import { photosQuerySchema } from "@lumio/shared";
import { listPhotos } from "@/lib/photos-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const parsed = photosQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const page = await listPhotos(parsed.data);
  return NextResponse.json(page);
}
