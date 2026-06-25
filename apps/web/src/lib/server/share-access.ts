/** True when `expiresAt` is set and at/after `now`. Lives here (a dependency-free
 *  module) so the pure access logic — and its tests — never pull in the heavy
 *  share-links-service import graph. The service re-exports it. */
export function isExpired(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && expiresAt.getTime() <= now.getTime();
}

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
