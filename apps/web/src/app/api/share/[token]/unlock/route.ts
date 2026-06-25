import { NextResponse } from "next/server";
import { shareUnlockSchema, FeatureKey } from "@lumio/shared";
import { isFeatureEnabled, getCatalogById } from "@lumio/db";
import { parseJson, errorJson } from "@/lib/server/route-helpers";
import { resolveShareLink, isExpired } from "@/lib/server/share-links-service";
import { verifyPassword, signUnlock } from "@/lib/server/share-crypto";
import { unlockCookieName } from "@/lib/server/with-share";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const parsed = await parseJson(request, shareUnlockSchema);
  if ("response" in parsed) return parsed.response;

  const link = await resolveShareLink(token);
  if (!link || isExpired(link.expiresAt, new Date()) || !link.passwordHash) {
    return errorJson("Not found", 404);
  }
  const catalog = await getCatalogById(link.catalogId);
  if (!catalog || !(await isFeatureEnabled(catalog.id, FeatureKey.Sharing))) {
    return errorJson("Not found", 404);
  }
  if (!(await verifyPassword(parsed.data.password, link.passwordHash))) {
    return errorJson("Incorrect password", 401);
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(unlockCookieName(token), signUnlock(token), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" || process.env.USE_SECURE_COOKIES === "true",
    path: "/",
    maxAge: 60 * 60 * 12, // 12 hours
  });
  return res;
}
