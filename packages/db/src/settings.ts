import type { PrismaClient } from "@prisma/client";
import type { UpdateSettingsInput } from "@lumio/shared";
import { prisma } from "./client.js";

const SINGLETON_ID = 1;

export interface AppSettingsDTO {
  uploadTemplate: string;
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
  return { uploadTemplate: row.uploadTemplate };
}

/** Persist new settings on the singleton row. */
export async function updateSettings(
  input: UpdateSettingsInput,
  db: Pick<PrismaClient, "appSettings"> = prisma,
): Promise<AppSettingsDTO> {
  const row = await db.appSettings.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, uploadTemplate: input.uploadTemplate },
    update: { uploadTemplate: input.uploadTemplate },
  });
  return { uploadTemplate: row.uploadTemplate };
}
