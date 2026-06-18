import { NextResponse } from "next/server";
import { updateSettings } from "@lumio/db";
import { updateSettingsSchema } from "@lumio/shared";
import { requireSession } from "@/lib/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request): Promise<NextResponse> {
  const guard = await requireSession();
  if (guard.response) return guard.response;

  const body: unknown = await request.json();
  const parsed = updateSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const settings = await updateSettings(parsed.data);
  return NextResponse.json(settings);
}
