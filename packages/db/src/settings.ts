import type { PrismaClient } from "@prisma/client";
import type { UpdateSettingsInput } from "@lumio/shared";
import { prisma } from "./client.js";

const SINGLETON_ID = 1;

export interface AppSettingsDTO {
  uploadTemplate: string;
  soundEffectsEnabled: boolean;
}

/** Get the singleton settings row, creating it with defaults if absent. */
export async function getSettings(
  db: Pick<PrismaClient, "appSettings"> = prisma,
): Promise<AppSettingsDTO> {
  const row = await db.appSettings.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID },
    update: {},
  });
  return { uploadTemplate: row.uploadTemplate, soundEffectsEnabled: row.soundEffectsEnabled };
}

/** Persist a partial settings change on the singleton row — only the fields
 *  present in `input` are written, so independent forms don't clobber each other. */
export async function updateSettings(
  input: UpdateSettingsInput,
  db: Pick<PrismaClient, "appSettings"> = prisma,
): Promise<AppSettingsDTO> {
  const data: { uploadTemplate?: string; soundEffectsEnabled?: boolean } = {};
  if (input.uploadTemplate !== undefined) data.uploadTemplate = input.uploadTemplate;
  if (input.soundEffectsEnabled !== undefined) data.soundEffectsEnabled = input.soundEffectsEnabled;
  const row = await db.appSettings.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, ...data },
    update: data,
  });
  return { uploadTemplate: row.uploadTemplate, soundEffectsEnabled: row.soundEffectsEnabled };
}
