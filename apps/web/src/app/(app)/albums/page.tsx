import Link from "next/link";
import { listAlbumSummaries } from "@/lib/albums-service";
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
        <p className="text-sm text-muted-foreground">No albums yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
          {albums.map((album) => (
            <Link key={album.id} href={`/albums/${album.id}`} className="group block">
              <div className="aspect-[4/3] overflow-hidden rounded-xl bg-muted">
                {album.coverPhotoId ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/thumbnails/${album.coverPhotoId}`}
                    alt={album.name}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                  />
                ) : null}
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
