import { listAlbumSummaries } from "@/lib/albums-service";
import { getPhoto, getPhotoNeighbors } from "@/lib/photos-service";

export interface PhotoDetailData {
  photo: NonNullable<Awaited<ReturnType<typeof getPhoto>>>;
  regularAlbums: Awaited<ReturnType<typeof listAlbumSummaries>>;
  neighbors: Awaited<ReturnType<typeof getPhotoNeighbors>>;
}

/**
 * Loads everything the detail view needs: the photo, the regular albums (for the
 * membership checkboxes), and the prev/next + film-strip neighbors scoped by
 * `albumId` (null = whole library). Returns null when the photo is missing so
 * callers can `notFound()`.
 */
export async function loadPhotoDetail(
  id: string,
  albumId: string | null,
): Promise<PhotoDetailData | null> {
  const photo = await getPhoto(id);
  if (!photo) return null;
  const [albums, neighbors] = await Promise.all([
    listAlbumSummaries(),
    getPhotoNeighbors({ id: photo.id, path: photo.path }, albumId),
  ]);
  return {
    photo,
    regularAlbums: albums.filter((a) => !a.isSmart),
    neighbors,
  };
}
