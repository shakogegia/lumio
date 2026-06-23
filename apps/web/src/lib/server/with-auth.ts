import { requireSession } from "@/lib/server/server-session";

// The authenticated session type, derived from requireSession's success branch.
type AuthedSession = Extract<
  Awaited<ReturnType<typeof requireSession>>,
  { response: null }
>["session"];

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
