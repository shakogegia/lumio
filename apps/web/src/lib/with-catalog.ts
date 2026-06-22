import { getCatalogBySlug, type Catalog } from "@lumio/db";
import { withAuth } from "@/lib/with-auth";

// The authenticated session type, derived from withAuth's handler parameter.
type AuthedSession = Parameters<Parameters<typeof withAuth>[0]>[2];

export type CatalogContext<P = Record<string, string>> = {
  params: Promise<P & { catalog: string }>;
};

export type CatalogExtras = { session: AuthedSession; catalog: Catalog };

type CatalogHandler<P> = (
  request: Request,
  context: CatalogContext<P>,
  extras: CatalogExtras,
) => Promise<Response> | Response;

/**
 * Wraps a route handler so it only runs for authenticated requests, and also
 * resolves the [catalog] slug from the route params into a Catalog row (404 if
 * unknown). The wrapped handler receives both the session and the resolved
 * catalog via the `extras` argument.
 */
export function withCatalog<P = Record<string, string>>(handler: CatalogHandler<P>) {
  return withAuth<CatalogContext<P>>(async (request, context, session) => {
    const { catalog: slug } = await context.params;
    const catalog = await getCatalogBySlug(slug);
    if (!catalog) return new Response("Catalog not found", { status: 404 });
    return handler(request, context, { session, catalog });
  });
}
