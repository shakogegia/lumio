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

/** A `YYYY-MM` month filter (e.g. "2026-06"). Strict zero-padded month 01–12. */
export const monthParamSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month must be in YYYY-MM form");

/** Query params for GET /api/photos. */
export const photosQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  sort: photoSortSchema.optional(),
  month: monthParamSchema.optional(),
  favorite: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});

export type PhotosQuery = z.infer<typeof photosQuerySchema>;

/** Offset-paginated photo list response. `total` is the full match count. */
export interface PhotosPage {
  items: PhotoDTO[];
  total: number;
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
  offset: z.coerce.number().int().min(0).default(0),
  sort: photoSortSchema.optional(),
  month: monthParamSchema.optional(),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;

/** Response for GET /api/search?count=1 — total photos matching the filters. */
export interface SearchCount {
  total: number;
}

/** Body for POST /api/photos/color-label. `label: null` clears the label. */
export const setColorLabelSchema = z.object({
  photoIds: z.array(z.string().min(1)).min(1),
  label: colorLabelSchema.nullable(),
});

export type SetColorLabelBody = z.infer<typeof setColorLabelSchema>;

/** Body for POST /api/photos/favorite. */
export const setFavoriteSchema = z.object({
  photoIds: z.array(z.string().min(1)).min(1),
  isFavorite: z.boolean(),
});

export type SetFavoriteBody = z.infer<typeof setFavoriteSchema>;
