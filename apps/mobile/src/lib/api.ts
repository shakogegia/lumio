/**
 * Validate and normalize a user-entered Lumio server URL.
 *
 * Returns the URL with surrounding whitespace and any trailing slash removed.
 * Throws a user-facing message when the input is empty or not an http(s) URL.
 */
export function normalizeServerUrl(input: string): string {
  const value = input.trim();
  if (!value) {
    throw new Error("Please enter your Lumio server URL.");
  }
  if (!/^https?:\/\//i.test(value)) {
    throw new Error("Server URL must start with http:// or https://");
  }
  return value.replace(/\/+$/, "");
}
