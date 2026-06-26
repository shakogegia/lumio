import { z } from "zod";
import { colorLabelSchema } from "./color-labels.js";
import { type FilterSet, filterSetSchema } from "./filters.js";
import { COLOR_FIELDS } from "./photo-color.js";
import type { PhotoDTO } from "./types.js";

/** The six photo sort orderings, single source of truth. */
export const PHOTO_SORTS = [
  "taken-desc",
  "taken-asc",
  "imported-desc",
  "imported-asc",
  "file-created-desc",
  "file-created-asc",
] as const;

export type PhotoSort =
  | (typeof PHOTO_SORTS)[number]
  | `meta:${string}:asc`
  | `meta:${string}:desc`;

/** The default ordering: newest imported-date first. */
export const DEFAULT_PHOTO_SORT: PhotoSort = "imported-desc";

/** `meta:<fieldId>:<dir>` — sort by a custom metadata field's value. fieldId is a
 *  cuid (lowercase alphanumeric); dir is asc|desc. Single regex for test+parse. */
const META_SORT_RE = /^meta:([a-z0-9]+):(asc|desc)$/;

/** Build a metadata-field sort token. */
export function metadataSort(fieldId: string, dir: "asc" | "desc"): PhotoSort {
  return `meta:${fieldId}:${dir}`;
}

/** Parse a metadata-field sort token, or null if it is not one. */
export function parseMetadataSort(
  sort: string | undefined,
): { fieldId: string; dir: "asc" | "desc" } | null {
  const m = sort ? META_SORT_RE.exec(sort) : null;
  return m ? { fieldId: m[1]!, dir: m[2] as "asc" | "desc" } : null;
}

/** A valid sort token: a fixed sort or a well-formed metadata sort. Field
 *  existence is validated server-side (see resolveSort). */
export function isPhotoSort(value: unknown): value is PhotoSort {
  return (
    (typeof value === "string" && META_SORT_RE.test(value)) ||
    (PHOTO_SORTS as readonly unknown[]).includes(value)
  );
}

/** Zod schema for a sort value (used in API query schemas). Accepts fixed and
 *  metadata sorts; rejects malformed input. */
export const photoSortSchema = z.custom<PhotoSort>((v) => isPhotoSort(v), {
  message: "invalid sort",
});

/** Coerce arbitrary input to a known sort, falling back to the default.
 *  Lenient (never throws) — for localStorage and detail-route query params. */
export function coercePhotoSort(value: unknown): PhotoSort {
  return isPhotoSort(value) ? value : DEFAULT_PHOTO_SORT;
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

export const cropRectSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().min(0).max(1),
    h: z.number().min(0).max(1),
  })
  .refine((c) => c.x + c.w <= 1 + 1e-6 && c.y + c.h <= 1 + 1e-6, {
    message: "crop extends past image bounds",
  });
export type CropRectInput = z.infer<typeof cropRectSchema>;

/** The color half of the edit schema, derived so COLOR_FIELDS is the single source
 *  of truth for every adjustment's range (see photo-color.ts). */
const colorFieldSchemas = Object.fromEntries(
  COLOR_FIELDS.map((f) => [f.key, z.number().min(f.min).max(f.max).optional()]),
) as { [K in (typeof COLOR_FIELDS)[number]["key"]]: z.ZodOptional<z.ZodNumber> };

const curvePointSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
const curveSpecSchema = z.object({
  master: z.array(curvePointSchema).optional(),
  r: z.array(curvePointSchema).optional(),
  g: z.array(curvePointSchema).optional(),
  b: z.array(curvePointSchema).optional(),
});

/** Edit recipe payload. Used by POST /api/photos/[id]/edit (null = reset). */
export const photoEditsSchema = z.object({
  version: z.number().int().min(1).optional(),
  rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  flipH: z.boolean(),
  flipV: z.boolean(),
  straighten: z.number().min(-45).max(45).optional(),
  crop: cropRectSchema.nullable().optional(),
  curves: curveSpecSchema.optional(),
  ...colorFieldSchemas,
});
export const editPhotoSchema = z.object({ edits: photoEditsSchema.nullable() });
export type EditPhotoInput = z.infer<typeof editPhotoSchema>;

/** Which bytes a download returns. */
export const downloadVariantSchema = z.enum(["original", "edited"]);
export type DownloadVariant = z.infer<typeof downloadVariantSchema>;

/** Body for POST /api/photos/download — bulk zip, original or edited. */
export const downloadRequestSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  variant: downloadVariantSchema.default("original"),
});

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
  filter: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v == null || v === "") return undefined;
      let json: unknown;
      try {
        json = JSON.parse(v);
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "filter is not valid JSON" });
        return z.NEVER;
      }
      const result = filterSetSchema.safeParse(json);
      if (!result.success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalid filter" });
        return z.NEVER;
      }
      // ruleSchema types `value` as `unknown` (it's validated imperatively in
      // superRefine, not statically narrowed), so cast to the declared interface.
      return result.data as FilterSet;
    }),
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
