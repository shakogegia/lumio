import { notFound } from "next/navigation";
import { getPhoto } from "@/lib/photos-service";
import { listAlbumSummaries } from "@/lib/albums-service";
import { PhotoDetail } from "./photo-detail";

export const dynamic = "force-dynamic";

export default async function PhotoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [photo, albums] = await Promise.all([
    getPhoto(id),
    listAlbumSummaries(),
  ]);
  if (!photo) notFound();

  const regularAlbums = albums.filter((a) => !a.isSmart);

  return (
    <main className="mx-auto max-w-5xl p-4">
      <PhotoDetail photo={photo} regularAlbums={regularAlbums} />
    </main>
  );
}
