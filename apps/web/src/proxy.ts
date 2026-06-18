import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { isPublicPath } from "@/lib/auth-paths";

// Optimistic gate only (cookie presence, no DB). Real enforcement is the
// (app) layout + per-route requireSession. Pages → redirect to /login;
// API routes → 401 JSON.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  if (!getSessionCookie(request)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = new URL("/login", request.url);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Skip Next internals and static asset files; run on everything else.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpe?g|gif|svg|webp|avif|ico|txt|xml|woff2?)$).*)",
  ],
};
