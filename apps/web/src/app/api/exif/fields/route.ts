import { NextResponse } from "next/server";
import { distinctFields } from "@/lib/exif-discovery";
import { withAuth } from "@/lib/server/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async () => {
  try {
    return NextResponse.json({ fields: await distinctFields() });
  } catch (err) {
    console.error("exif fields discovery failed", err);
    return NextResponse.json({ fields: [] });
  }
});
