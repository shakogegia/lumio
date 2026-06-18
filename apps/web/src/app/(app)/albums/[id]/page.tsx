import { notFound } from "next/navigation";
import { getAlbum } from "@/lib/albums-service";
import { AlbumView } from "./album-view";

export const dynamic = "force-dynamic";

export default async function AlbumDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const album = await getAlbum(id);
  if (!album) notFound();

  return (
    <main className="w-full p-6">
      <AlbumView albumId={album.id} albumName={album.name} isSmart={album.isSmart} />
    </main>
  );
}
