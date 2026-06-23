import { NextResponse } from "next/server";
import { updateProfileSchema } from "@lumio/shared";
import { withAuth } from "@/lib/with-auth";
import { getProfile, updateProfile } from "@/lib/profile-service";
import { parseJson } from "@/lib/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (_request, _context, session) => {
  return NextResponse.json(await getProfile(session.user.id));
});

export const PUT = withAuth(async (request, _context, session) => {
  const parsed = await parseJson(request, updateProfileSchema);
  if ("response" in parsed) return parsed.response;
  return NextResponse.json(await updateProfile(session.user.id, parsed.data));
});
