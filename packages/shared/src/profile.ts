import { z } from "zod";

/** Body for PUT /api/profile — update user preferences. */
export const updateProfileSchema = z.object({
  soundEffectsEnabled: z.boolean().optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
