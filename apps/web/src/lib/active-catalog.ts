import "server-only";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getCatalogBySlug, listCatalogs } from "@lumio/db";

export const LAST_CATALOG_COOKIE = "lumio.lastCatalog";

/** Resolve a slug → catalog, 404 if it doesn't exist. Cached per-request. */
export const getCatalogForSlug = cache(async (slug: string) => {
  const catalog = await getCatalogBySlug(slug);
  if (!catalog) notFound();
  return catalog;
});

/** Slug to redirect to from "/": last-used cookie (if still valid) else the first catalog, else null. */
export async function getDefaultCatalogSlug(): Promise<string | null> {
  const all = await listCatalogs();
  if (all.length === 0) return null;
  const last = (await cookies()).get(LAST_CATALOG_COOKIE)?.value;
  if (last && all.some((c) => c.slug === last)) return last;
  return all[0]!.slug;
}
