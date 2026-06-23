import "server-only";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/server/auth";

/** Current session (or null) from request cookies — for server components. */
export async function getServerSession() {
  return auth.api.getSession({ headers: await headers() });
}

/**
 * API-route guard. Returns `{ session }` when authed, or `{ response }` (a 401)
 * when not. Usage:
 *   const guard = await requireSession();
 *   if (guard.response) return guard.response;
 */
export async function requireSession(): Promise<
  | { session: NonNullable<Awaited<ReturnType<typeof getServerSession>>>; response: null }
  | { session: null; response: NextResponse }
> {
  const session = await getServerSession();
  if (!session) {
    return {
      session: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { session, response: null };
}
