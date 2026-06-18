import { NextResponse } from "next/server";
import { updateSettings } from "@lumio/db";
import { updateSettingsSchema } from "@lumio/shared";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PUT = withAuth(async (request) => {
  const body: unknown = await request.json();
  const parsed = updateSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const settings = await updateSettings(parsed.data);
  return NextResponse.json(settings);
});
