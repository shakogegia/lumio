import { catalogPath } from "@/lib/catalog-api";

/** The photo id in a `/photo/[id]` pathname, or null if it is not such a path. */
export function photoIdFromPathname(pathname: string): string | null {
  const m = /^\/photo\/([^/]+)\/?$/.exec(pathname);
  return m?.[1] ?? null;
}

/**
 * True when `pathname` is the photo-detail route for `slug`
 * (`/c/<slug>/photo/<id>`), as opposed to the grid route `/c/<slug>/photos` or
 * any sibling. Matching the full `/c/<slug>/photo/` prefix (not a bare `/photo/`
 * substring) keeps the grid route — and a catalog literally named "photo" —
 * from being misread as a detail route.
 */
export function isPhotoDetailPath(pathname: string, slug: string): boolean {
  return pathname.startsWith(catalogPath(slug, "/photo/"));
}
