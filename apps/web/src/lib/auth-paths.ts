/** Routes reachable without a session: auth pages + the Better Auth API. */
export function isPublicPath(pathname: string): boolean {
  // /two-factor is the sign-in 2FA challenge; the user has no full session
  // cookie yet (only a temporary 2FA cookie), so the proxy must let it through.
  if (
    pathname === "/login" ||
    pathname === "/setup" ||
    pathname === "/two-factor"
  ) {
    return true;
  }
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) return true;
  // Public share links: the no-login gallery page and its token-scoped API.
  // The proxy is only an optimistic cookie gate; real access control (feature
  // flag, expiry, password, photo membership) is enforced by the /share page
  // and the withShare-wrapped /api/share routes.
  if (pathname.startsWith("/share/")) return true;
  if (pathname === "/api/share" || pathname.startsWith("/api/share/")) return true;
  return false;
}
