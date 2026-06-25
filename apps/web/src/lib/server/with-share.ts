import "server-only";
import { cookies } from "next/headers";
import { type Catalog, type ShareLink, getCatalogById, isFeatureEnabled } from "@lumio/db";
import { FeatureKey } from "@lumio/shared";
import { resolveShareLink } from "@/lib/server/share-links-service";
import { evaluateShareAccess } from "@/lib/server/share-access";
import { verifyUnlock } from "@/lib/server/share-crypto";

export const SHARE_UNLOCK_PREFIX = "lumio.share.";
export function unlockCookieName(token: string): string {
  return `${SHARE_UNLOCK_PREFIX}${token}`;
}

export type ShareExtras = { shareLink: ShareLink; catalog: Catalog };
export type ShareContext<P = Record<string, string>> = { params: Promise<P & { token: string }> };

type ShareHandler<P> = (
  request: Request,
  context: ShareContext<P>,
  extras: ShareExtras,
) => Promise<Response> | Response;

/**
 * Wrap a public route handler so it only runs for a valid, enabled, unexpired,
 * (and if needed) unlocked share token. Mirrors withCatalog's shape, but uses
 * the share token instead of a session.
 */
export function withShare<P = Record<string, string>>(handler: ShareHandler<P>) {
  return async (request: Request, context: ShareContext<P>): Promise<Response> => {
    const { token } = await context.params;
    const shareLink = await resolveShareLink(token);
    if (!shareLink) return new Response("Not found", { status: 404 });

    const catalog = await getCatalogById(shareLink.catalogId);
    if (!catalog) return new Response("Not found", { status: 404 });

    const featureEnabled = await isFeatureEnabled(catalog.id, FeatureKey.Sharing);
    const cookieVal = (await cookies()).get(unlockCookieName(token))?.value ?? "";
    const unlocked = verifyUnlock(token, cookieVal);

    const access = evaluateShareAccess({ link: shareLink, featureEnabled, unlocked, now: new Date() });
    if (!access.ok) {
      return new Response(access.reason === "password" ? "Password required" : "Not found", {
        status: access.reason === "password" ? 401 : 404,
      });
    }
    return handler(request, context, { shareLink, catalog });
  };
}
