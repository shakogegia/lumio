/**
 * Resolve and validate the Lumio backend base URL for the mobile app.
 *
 * Reads from EXPO_PUBLIC_API_URL (see .env.example). Fails fast with a clear
 * message so a misconfigured device doesn't produce confusing network errors.
 * Returns the URL with any trailing slash removed.
 */
export function resolveApiBaseUrl(
  raw: string | undefined = process.env.EXPO_PUBLIC_API_URL,
): string {
  const value = raw?.trim();
  if (!value) {
    throw new Error(
      "EXPO_PUBLIC_API_URL is not set. Copy apps/mobile/.env.example to " +
        "apps/mobile/.env and point it at your running Lumio backend.",
    );
  }
  if (!/^https?:\/\//.test(value)) {
    throw new Error(
      `EXPO_PUBLIC_API_URL must be an http(s) URL, got: ${value}`,
    );
  }
  return value.replace(/\/+$/, "");
}
