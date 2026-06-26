import { NextResponse } from "next/server";
import { distinctValues } from "@/lib/exif-discovery";
import { withAuth } from "@/lib/server/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (request) => {
  const field = new URL(request.url).searchParams.get("field");
  if (!field) return NextResponse.json({ error: "field is required" }, { status: 400 });
  try {
    return NextResponse.json({ values: await distinctValues(field) });
  } catch (err) {
    console.error("exif values discovery failed", err);
    return NextResponse.json({ values: [] });
  }
});
