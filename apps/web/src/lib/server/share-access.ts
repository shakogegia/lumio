import { isExpired } from "@/lib/server/share-links-service";

/** Pure access decision for a share link. */
export function evaluateShareAccess(args: {
  link: { passwordHash: string | null; expiresAt: Date | null };
  featureEnabled: boolean;
  unlocked: boolean;
  now: Date;
}): { ok: true } | { ok: false; reason: "unavailable" | "password" } {
  if (!args.featureEnabled) return { ok: false, reason: "unavailable" };
  if (isExpired(args.link.expiresAt, args.now)) return { ok: false, reason: "unavailable" };
  if (args.link.passwordHash && !args.unlocked) return { ok: false, reason: "password" };
  return { ok: true };
}
