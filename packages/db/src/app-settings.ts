import type { PrismaClient } from "@prisma/client";
import { prisma } from "./client.js";

type AppSettingDb = Pick<PrismaClient, "appSetting">;

export async function getAppSetting(key: string, db: AppSettingDb = prisma): Promise<string | null> {
  const row = await db.appSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setAppSetting(key: string, value: string, db: AppSettingDb = prisma): Promise<void> {
  await db.appSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}
