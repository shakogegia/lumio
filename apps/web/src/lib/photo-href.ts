/**
 * URL for a photo's detail route, carrying the navigation scope. When an album
 * id is present, neighbors/film-strip navigate within that album; otherwise the
 * whole library. This is the one place the `?album=` convention is defined.
 */
export function photoHref(id: string, albumId?: string | null): string {
  return albumId ? `/photo/${id}?album=${encodeURIComponent(albumId)}` : `/photo/${id}`;
}
