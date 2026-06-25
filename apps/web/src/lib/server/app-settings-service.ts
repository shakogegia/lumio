import { type PrismaClient, prisma, getAppSetting, setAppSetting } from "@lumio/db";
import {
  PUBLIC_BASE_URL_KEY,
  normalizeBaseUrl,
  type GeneralSettingsDTO,
  type UpdateGeneralSettingsInput,
} from "@lumio/shared";

type Db = Pick<PrismaClient, "appSetting">;

export class InvalidBaseUrlError extends Error {
  constructor(message = "Public base URL must be a valid http(s) URL") {
    super(message);
  }
}

export async function getGeneralSettings(db: Db = prisma): Promise<GeneralSettingsDTO> {
  const publicBaseUrl = await getAppSetting(PUBLIC_BASE_URL_KEY, db);
  return { publicBaseUrl: publicBaseUrl ?? null };
}

export async function updateGeneralSettings(
  input: UpdateGeneralSettingsInput,
  db: Db = prisma,
): Promise<GeneralSettingsDTO> {
  const raw = input.publicBaseUrl.trim();
  if (raw === "") {
    await setAppSetting(PUBLIC_BASE_URL_KEY, "", db);
    return { publicBaseUrl: null };
  }
  const normalized = normalizeBaseUrl(raw);
  if (normalized === null) throw new InvalidBaseUrlError();
  await setAppSetting(PUBLIC_BASE_URL_KEY, normalized, db);
  return { publicBaseUrl: normalized };
}

/** The configured base URL, or null. Used by share-link creation. */
export async function getPublicBaseUrl(db: Db = prisma): Promise<string | null> {
  const value = await getAppSetting(PUBLIC_BASE_URL_KEY, db);
  return value ? value : null;
}
