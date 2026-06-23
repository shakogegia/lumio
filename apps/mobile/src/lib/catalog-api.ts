// Minimal client for the server's catalog endpoint. Auth is the Better Auth
// session cookie (from the Expo client's getCookie()), same as the web app.

export type Catalog = { id: string; name: string; slug: string };

export async function fetchCatalogs(baseURL: string, cookie: string): Promise<Catalog[]> {
  let res: Response;
  try {
    res = await fetch(`${baseURL}/api/catalogs`, {
      headers: { accept: "application/json", Cookie: cookie },
    });
  } catch {
    throw new Error("Couldn't reach the server.");
  }
  if (!res.ok) {
    throw new Error(`Couldn't load catalogs (${res.status}).`);
  }
  const rows = (await res.json()) as { id: string; name: string; slug: string }[];
  return rows.map(({ id, name, slug }) => ({ id, name, slug }));
}
