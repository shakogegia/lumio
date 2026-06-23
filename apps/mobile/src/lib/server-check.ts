/**
 * Confirm a base URL points at a reachable Lumio (Better Auth) server.
 * Better Auth exposes GET /api/auth/ok -> { ok: true }. Throws a user-facing
 * message on network failure or a non-Lumio response.
 */
export async function pingLumioServer(baseURL: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${baseURL}/api/auth/ok`, {
      method: "GET",
      headers: { accept: "application/json" },
    });
  } catch {
    throw new Error("Could not reach that server. Check the URL and your network.");
  }
  if (!res.ok) {
    throw new Error(`That server responded with ${res.status}. Is the URL correct?`);
  }
  try {
    const body = (await res.json()) as { ok?: boolean };
    if (body && body.ok === false) {
      throw new Error("That doesn't look like a Lumio server.");
    }
  } catch {
    // non-JSON 200 — accept.
  }
}
