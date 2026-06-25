import { z } from "zod";

/** AppSetting key for the app-wide public base URL (used to build share links). */
export const PUBLIC_BASE_URL_KEY = "publicBaseUrl";

/**
 * Validate + normalize a public base URL. Returns the canonical
 * `<protocol>//<host>[<path>]` form (no trailing slash), or null if the input
 * is empty or not a valid http(s) URL.
 */
export function normalizeBaseUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}`;
}

/** Body for PUT /api/settings/general. Empty string clears the setting. */
export const updateGeneralSettingsSchema = z.object({
  publicBaseUrl: z.string().trim().max(2000),
});
export type UpdateGeneralSettingsInput = z.infer<typeof updateGeneralSettingsSchema>;

export interface GeneralSettingsDTO {
  publicBaseUrl: string | null;
}
