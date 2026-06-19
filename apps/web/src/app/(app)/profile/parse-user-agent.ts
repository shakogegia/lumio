/** A human-readable device summary derived from a session's userAgent string. */
export interface ParsedUserAgent {
  browser: string;
  os: string;
}

/**
 * Best-effort parse of a userAgent into { browser, os }. Order matters: Edge
 * and Chrome both contain "Chrome"; Android UAs also contain "Linux"; iOS UAs
 * also contain "Mac OS X" — so the more specific checks come first. Falls back
 * to "Unknown" for missing or unrecognized strings.
 */
export function parseUserAgent(ua: string | null | undefined): ParsedUserAgent {
  if (!ua) return { browser: "Unknown browser", os: "Unknown OS" };
  return { browser: detectBrowser(ua), os: detectOS(ua) };
}

function detectBrowser(ua: string): string {
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\/|Opera\//.test(ua)) return "Opera";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Version\//.test(ua) && /Safari\//.test(ua)) return "Safari";
  return "Unknown browser";
}

function detectOS(ua: string): string {
  if (/Windows NT/.test(ua)) return "Windows";
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Android/.test(ua)) return "Android";
  if (/Mac OS X/.test(ua)) return "macOS";
  if (/Linux/.test(ua)) return "Linux";
  return "Unknown OS";
}
