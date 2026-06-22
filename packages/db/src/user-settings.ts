import type { PrismaClient } from "@prisma/client";
import { prisma } from "./client.js";

type UserSettingsDb = Pick<PrismaClient, "userSettings">;

export interface UserSettingsDTO { soundEffectsEnabled: boolean; }

export async function getUserSettings(userId: string, db: UserSettingsDb = prisma): Promise<UserSettingsDTO> {
  const row = await db.userSettings.upsert({ where: { userId }, create: { userId }, update: {} });
  return { soundEffectsEnabled: row.soundEffectsEnabled ?? true };
}

export async function updateUserSettings(userId: string, input: Partial<UserSettingsDTO>, db: UserSettingsDb = prisma): Promise<UserSettingsDTO> {
  const data: { soundEffectsEnabled?: boolean } = {};
  if (input.soundEffectsEnabled !== undefined) data.soundEffectsEnabled = input.soundEffectsEnabled;
  const row = await db.userSettings.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  return { soundEffectsEnabled: row.soundEffectsEnabled ?? true };
}
