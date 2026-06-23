import { z } from "zod";

/** Make a URL-safe slug from a catalog name. Always returns a non-empty value. */
export function slugify(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return base || "catalog";
}

export interface CatalogDTO { id: string; name: string; slug: string; path: string; uploadTemplate: string; }

export const createCatalogSchema = z.object({ name: z.string().trim().min(1).max(120), path: z.string().trim().min(1) });
export type CreateCatalogInput = z.infer<typeof createCatalogSchema>;

/** Body for PATCH /api/catalogs/[id] — rename or reorder a catalog. */
export const updateCatalogSchema = z.union([
  z.object({ afterId: z.string().min(1).nullable() }),
  z.object({ name: z.string().trim().min(1) }),
]);
export type UpdateCatalogInput = z.infer<typeof updateCatalogSchema>;

/** Body for PUT /api/c/[catalog]/settings — update catalog settings. */
export const updateCatalogSettingsSchema = z.object({ uploadTemplate: z.string() });
export type UpdateCatalogSettingsInput = z.infer<typeof updateCatalogSettingsSchema>;
