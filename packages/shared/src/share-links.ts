import { z } from "zod";

/** Empty-or-whitespace strings collapse to undefined (treated as "not set"). */
const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

/** Body for POST /api/c/[catalog]/share-links. */
export const createShareLinkSchema = z.object({
  photoIds: z.array(z.string().min(1)).min(1),
  title: optionalTrimmed(200),
  password: optionalTrimmed(200),
  expiresAt: z.string().datetime().nullish().transform((v) => v ?? undefined),
});
export type CreateShareLinkInput = z.infer<typeof createShareLinkSchema>;

/** Body for POST /api/share/[token]/unlock. */
export const shareUnlockSchema = z.object({
  password: z.string().min(1),
});
export type ShareUnlockInput = z.infer<typeof shareUnlockSchema>;

/** One share link as shown in the management list and returned on create. */
export interface ShareLinkSummaryDTO {
  id: string;
  token: string;
  url: string;
  title: string | null;
  hasPassword: boolean;
  expiresAt: string | null;
  isExpired: boolean;
  photoCount: number;
  coverPhotoId: string | null;
  createdAt: string;
}
