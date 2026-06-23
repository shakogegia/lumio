/**
 * Thin fetch helpers for JSON API calls. Use these instead of hand-rolling
 * the headers/stringify/method combination on every callsite.
 *
 * These helpers throw on non-ok responses (including an `${status} ${url}`
 * message for diagnostics). Callers own error handling/toasts.
 */

/**
 * POST JSON body and return the raw Response. Use this when you need to
 * inspect headers, read a blob, or do bespoke response handling.
 */
export async function postJson(url: string, body: unknown, method = "POST"): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.url}`);
  return res;
}

/**
 * Convenience: PATCH JSON body. Identical to postJson with method "PATCH".
 */
export async function patchJson(url: string, body: unknown): Promise<Response> {
  return postJson(url, body, "PATCH");
}
