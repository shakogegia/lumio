import { notFound } from "next/navigation";
import { getAlbum } from "@/lib/albums-service";
import { Badge } from "@/components/ui/badge";
import { PhotoGrid } from "@/app/photos/photo-grid";
import { DeleteAlbumButton } from "./delete-album-button";

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
    <main className="mx-auto max-w-7xl p-4">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{album.name}</h1>
          {album.isSmart && <Badge variant="secondary">Smart</Badge>}
        </div>
        <DeleteAlbumButton albumId={album.id} />
      </div>
      <PhotoGrid endpoint={`/api/albums/${id}/photos`} />
    </main>
  );
}
