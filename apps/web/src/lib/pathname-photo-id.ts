/** The photo id in a `/photo/[id]` pathname, or null if it is not such a path. */
export function photoIdFromPathname(pathname: string): string | null {
  const m = /^\/photo\/([^/]+)\/?$/.exec(pathname);
  return m?.[1] ?? null;
}
