import { NextResponse } from "next/server";
import { updateGeneralSettingsSchema } from "@lumio/shared";
import { withAuth } from "@/lib/server/with-auth";
import { parseJson, errorJson } from "@/lib/server/route-helpers";
import { getGeneralSettings, updateGeneralSettings, InvalidBaseUrlError } from "@/lib/server/app-settings-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async () => {
  return NextResponse.json(await getGeneralSettings());
});

export const PUT = withAuth(async (request) => {
  const parsed = await parseJson(request, updateGeneralSettingsSchema);
  if ("response" in parsed) return parsed.response;
  try {
    return NextResponse.json(await updateGeneralSettings(parsed.data));
  } catch (err) {
    if (err instanceof InvalidBaseUrlError) return errorJson(err.message, 400);
    throw err;
  }
});
