import { z } from "zod";
import type { PhotoDTO } from "./types.js";

/** Query params for GET /api/photos. */
export const photosQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});

export type PhotosQuery = z.infer<typeof photosQuerySchema>;

/** Cursor-paginated photo list response. */
export interface PhotosPage {
  items: PhotoDTO[];
  nextCursor: string | null;
}

/** Query params for GET /api/search. `album` may repeat in the query string. */
export const searchQuerySchema = z.object({
  q: z
    .string()
    .optional()
    .transform((v) => v?.trim() || undefined),
  album: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (v == null ? [] : Array.isArray(v) ? v : [v])),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;
