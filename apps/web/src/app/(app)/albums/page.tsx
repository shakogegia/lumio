import Link from "next/link";
import { FolderOpen, Images } from "lucide-react";
import { listAlbumSummaries } from "@/lib/albums-service";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { NewAlbumDialog } from "./new-album-dialog";

export const dynamic = "force-dynamic";

export default async function AlbumsPage() {
  const albums = await listAlbumSummaries();

  return (
    <main className="w-full p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Albums</h1>
        <NewAlbumDialog />
      </div>

      {albums.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderOpen />
            </EmptyMedia>
            <EmptyTitle>No albums yet</EmptyTitle>
            <EmptyDescription>Create an album to group your photos.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid grid-cols-3 gap-x-5 gap-y-7 sm:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6">
          {albums.map((album) => (
            <Link key={album.id} href={`/albums/${album.id}`} className="group block">
              <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl bg-muted">
                {album.coverPhotoId ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/thumbnails/${album.coverPhotoId}`}
                    alt={album.name}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                  />
                ) : (
                  <Images className="size-8 text-muted-foreground" />
                )}
              </div>
              <div className="mt-2.5">
                <p className="truncate text-sm font-semibold">{album.name}</p>
                <p className="text-xs text-muted-foreground">
                  {album.photoCount} {album.photoCount === 1 ? "photo" : "photos"}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
