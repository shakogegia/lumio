import { notFound } from "next/navigation";
import { getPhoto } from "@/lib/photos-service";
import { listAlbumSummaries } from "@/lib/albums-service";
import { RouteOverlay } from "@/components/route-overlay";
import { PhotoDetail } from "@/app/(app)/photo/[id]/photo-detail";

export const dynamic = "force-dynamic";

export default async function PhotoIntercept({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [photo, albums] = await Promise.all([getPhoto(id), listAlbumSummaries()]);
  if (!photo) notFound();

  const regularAlbums = albums.filter((a) => !a.isSmart);

  return (
    <RouteOverlay>
      <main className="p-4">
        <PhotoDetail photo={photo} regularAlbums={regularAlbums} />
      </main>
    </RouteOverlay>
  );
}
