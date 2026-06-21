import { z } from "zod";

export const createFolderSchema = z.object({
  name: z.string().min(1).max(200),
  parentId: z.string().min(1).nullish(),
});
export type CreateFolderInput = z.infer<typeof createFolderSchema>;

export const renameFolderSchema = z.object({
  name: z.string().min(1).max(200),
});
export type RenameFolderInput = z.infer<typeof renameFolderSchema>;

export const moveItemsSchema = z
  .object({
    folderIds: z.array(z.string().min(1)).optional(),
    albumIds: z.array(z.string().min(1)).optional(),
    targetFolderId: z.string().min(1).nullable(),
  })
  .refine((v) => (v.folderIds?.length ?? 0) + (v.albumIds?.length ?? 0) > 0, {
    message: "select at least one folder or album to move",
  });
export type MoveItemsInput = z.infer<typeof moveItemsSchema>;

export const folderDeleteModeSchema = z.object({
  mode: z.enum(["reparent", "cascade"]).default("reparent"),
});
export type FolderDeleteMode = z.infer<typeof folderDeleteModeSchema>["mode"];
