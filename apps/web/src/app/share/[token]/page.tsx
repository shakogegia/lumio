import { cookies } from "next/headers";
import type { Metadata } from "next";
import { getCatalogById, isFeatureEnabled } from "@lumio/db";
import { FeatureKey } from "@lumio/shared";
import { resolveShareLink, isExpired } from "@/lib/server/share-links-service";
import { verifyUnlock } from "@/lib/server/share-crypto";
import { unlockCookieName } from "@/lib/server/with-share";
import { ShareUnavailable } from "./share-unavailable";
import { SharePasswordGate } from "./share-password-gate";
import { ShareGalleryView } from "./share-gallery-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shared photos", robots: { index: false, follow: false } };

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await resolveShareLink(token);
  if (!link || isExpired(link.expiresAt, new Date())) return <ShareUnavailable />;

  const catalog = await getCatalogById(link.catalogId);
  if (!catalog || !(await isFeatureEnabled(catalog.id, FeatureKey.Sharing))) return <ShareUnavailable />;

  if (link.passwordHash) {
    const cookieVal = (await cookies()).get(unlockCookieName(token))?.value ?? "";
    if (!verifyUnlock(token, cookieVal)) return <SharePasswordGate token={token} title={link.title} />;
  }

  return <ShareGalleryView token={token} title={link.title} />;
}
