import { z } from "zod";
import { filterSetSchema } from "./filters.js";

export const createAlbumSchema = z
  .object({
    name: z.string().min(1).max(200),
    isSmart: z.boolean().default(false),
    rules: filterSetSchema.optional(),
    folderId: z.string().min(1).nullish(),
  })
  .refine((v) => (v.isSmart ? !!v.rules && v.rules.rules.length > 0 : !v.rules), {
    message: "smart albums require at least one rule; plain albums must omit rules",
  });

export const updateSmartAlbumRulesSchema = z.object({ rules: filterSetSchema });

export const albumPhotosSchema = z.object({
  photoIds: z.array(z.string().min(1)).min(1),
});
export type AlbumPhotosInput = z.infer<typeof albumPhotosSchema>;

export const setAlbumCoverSchema = z.object({
  coverPhotoId: z.string().min(1),
});
export type SetAlbumCoverInput = z.infer<typeof setAlbumCoverSchema>;

export const deleteAlbumsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});
export type DeleteAlbumsInput = z.infer<typeof deleteAlbumsSchema>;

export type CreateAlbumInput = z.infer<typeof createAlbumSchema>;

export const renameAlbumSchema = z.object({
  name: z.string().min(1).max(200),
});
export type RenameAlbumInput = z.infer<typeof renameAlbumSchema>;
