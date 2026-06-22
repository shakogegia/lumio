import { z } from "zod";

/** Make a URL-safe slug from a catalog name. Always returns a non-empty value. */
export function slugify(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return base || "catalog";
}

export interface CatalogDTO { id: string; name: string; slug: string; path: string; uploadTemplate: string; }

export const createCatalogSchema = z.object({ name: z.string().trim().min(1).max(120), path: z.string().trim().min(1) });
export type CreateCatalogInput = z.infer<typeof createCatalogSchema>;
