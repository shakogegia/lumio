import { NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import { MEDIA_ROOT, browseDir } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (request) => {
  const url = new URL(request.url);
  const p = url.searchParams.get("path") ?? MEDIA_ROOT;
  try {
    return NextResponse.json(await browseDir(p));
  } catch {
    return new Response("Invalid path", { status: 400 });
  }
});
