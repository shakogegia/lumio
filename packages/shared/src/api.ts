import { z } from "zod";
import { colorLabelSchema } from "./color-labels.js";
import type { PhotoDTO } from "./types.js";

/** The four photo sort orderings, single source of truth. */
export const PHOTO_SORTS = [
  "taken-desc",
  "taken-asc",
  "imported-desc",
  "imported-asc",
] as const;

export type PhotoSort = (typeof PHOTO_SORTS)[number];

/** The default ordering: newest taken-date first (today's behaviour). */
export const DEFAULT_PHOTO_SORT: PhotoSort = "taken-desc";

/** Zod enum for a sort value (strict — used in API query schemas). */
export const photoSortSchema = z.enum(PHOTO_SORTS);

/** Coerce arbitrary input to a known sort, falling back to the default.
 *  Lenient (never throws) — for localStorage and detail-route query params. */
export function coercePhotoSort(value: unknown): PhotoSort {
  return (PHOTO_SORTS as readonly unknown[]).includes(value)
    ? (value as PhotoSort)
    : DEFAULT_PHOTO_SORT;
}

/** Query params for GET /api/photos. */
export const photosQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
  sort: photoSortSchema.optional(),
});

export type PhotosQuery = z.infer<typeof photosQuerySchema>;

/** Cursor-paginated photo list response. */
export interface PhotosPage {
  items: PhotoDTO[];
  nextCursor: string | null;
}

/** Request body for bulk photo/trash operations. */
export const photoIdsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});

export type PhotoIdsInput = z.infer<typeof photoIdsSchema>;

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
  sort: photoSortSchema.optional(),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;

/** Body for POST /api/photos/color-label. `label: null` clears the label. */
export const setColorLabelSchema = z.object({
  photoIds: z.array(z.string().min(1)).min(1),
  label: colorLabelSchema.nullable(),
});

export type SetColorLabelBody = z.infer<typeof setColorLabelSchema>;
