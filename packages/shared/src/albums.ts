import { z } from "zod";
import { MatchType, RuleOp } from "./enums.js";

const last30 = z.object({
  field: z.literal("takenAt"),
  op: z.literal(RuleOp.last_30_days),
});
const cameraEq = z.object({
  field: z.literal("exif.cameraModel"),
  op: z.literal(RuleOp.eq),
  value: z.string().min(1),
});

export const smartRuleSchema = z.discriminatedUnion("field", [last30, cameraEq]);

export const smartRulesSchema = z.object({
  match: z.nativeEnum(MatchType),
  rules: z.array(smartRuleSchema).min(1),
});

export const createAlbumSchema = z
  .object({
    name: z.string().min(1).max(200),
    isSmart: z.boolean().default(false),
    rules: smartRulesSchema.optional(),
  })
  .refine((v) => (v.isSmart ? !!v.rules : !v.rules), {
    message: "smart albums require rules; regular albums must omit rules",
  });

export const albumPhotosSchema = z.object({
  photoIds: z.array(z.string().min(1)).min(1),
});
export type AlbumPhotosInput = z.infer<typeof albumPhotosSchema>;

export const deleteAlbumsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});
export type DeleteAlbumsInput = z.infer<typeof deleteAlbumsSchema>;

export type CreateAlbumInput = z.infer<typeof createAlbumSchema>;
