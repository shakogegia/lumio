import { NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import { getProfile, updateProfile } from "@/lib/profile-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (_request, _context, session) => {
  return NextResponse.json(await getProfile(session.user.id));
});

export const PUT = withAuth(async (request, _context, session) => {
  const body = (await request.json()) as { soundEffectsEnabled?: boolean };
  return NextResponse.json(await updateProfile(session.user.id, body));
});
