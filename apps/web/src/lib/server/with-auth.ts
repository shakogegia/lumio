import { requireSession } from "@/lib/server/server-session";

// The authenticated session type, derived from requireSession's success branch.
type AuthedSession = Extract<
  Awaited<ReturnType<typeof requireSession>>,
  { response: null }
>["session"];

/**
 * SINGLE-TENANT / SINGLE-ADMIN DESIGN NOTE
 * ==========================================
 * withAuth (and withCatalog below it) verify that a session is LOGGED IN —
 * they do NOT check catalog ownership or user-scoped resource access.
 *
 * This is intentional. Lumio is a single-admin application: first-run setup
 * creates one admin account, then assertSignupAllowed() hard-closes signup.
 * There is only ever one user, so "logged in" IS "authorized".
 *
 * Catalogs are intentionally GLOBAL — any authenticated session can read or
 * mutate any catalog. There is no Catalog.userId / ownership model today.
 * That model will be introduced alongside the multi-user / invite system
 * (roadmap-deferred). Adding a half-built tenancy guard now would be a
 * security trap: it would appear to protect resources it does not actually scope.
 *
 * Future maintainers: if you're reading this because you're adding multi-user
 * support, the ownership check belongs in withCatalog() (and ideally enforced
 * via a Prisma query filter, not a post-fetch check). See the spec at
 * docs/superpowers/specs/2026-06-23-refactor-phase-bc-design.md §Decision 2.
 */

type AuthedHandler<Ctx> = (
  request: Request,
  context: Ctx,
  session: AuthedSession,
) => Promise<Response> | Response;

/**
 * Wraps a route handler so it only runs for authenticated requests. Returns a
 * 401 (from requireSession) otherwise. The wrapped handler receives the
 * validated session as its third argument. Ctx is inferred from the handler's
 * own context parameter, so dynamic-route `{ params }` typing is preserved.
 */
export function withAuth<Ctx = unknown>(handler: AuthedHandler<Ctx>) {
  return async (request: Request, context: Ctx): Promise<Response> => {
    const guard = await requireSession();
    if (guard.response) return guard.response;
    return handler(request, context, guard.session);
  };
}
