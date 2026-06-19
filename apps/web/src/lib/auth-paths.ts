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
  return false;
}
