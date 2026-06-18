import { notFound } from "next/navigation";
import { Images } from "lucide-react";
import { getAlbum } from "@/lib/albums-service";
import { PhotoGrid } from "@/app/(app)/photos/photo-grid";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
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
    <main className="w-full p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{album.name}</h1>
        <DeleteAlbumButton albumId={album.id} />
      </div>
      <PhotoGrid
        endpoint={`/api/albums/${id}/photos`}
        empty={
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Images />
              </EmptyMedia>
              <EmptyTitle>This album is empty</EmptyTitle>
              <EmptyDescription>
                Photos you add to this album will appear here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        }
      />
    </main>
  );
}
