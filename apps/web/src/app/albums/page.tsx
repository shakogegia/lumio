import Link from "next/link";
import type { AlbumSummaryDTO } from "@lumio/shared";
import { listAlbumSummaries } from "@/lib/albums-service";
import { Card } from "@/components/ui/card";
import { NewAlbumDialog } from "./new-album-dialog";

export const dynamic = "force-dynamic";

export default async function AlbumsPage() {
  const albums = await listAlbumSummaries();
  const regular = albums.filter((a) => !a.isSmart);
  const smart = albums.filter((a) => a.isSmart);

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Albums</h1>
        <NewAlbumDialog />
      </div>
      <Section title="Albums" albums={regular} empty="No albums yet." />
      <Section title="Smart Albums" albums={smart} empty="No smart albums yet." />
    </main>
  );
}

function Section({
  title,
  albums,
  empty,
}: {
  title: string;
  albums: AlbumSummaryDTO[];
  empty: string;
}) {
  return (
    <section>
      <h2 className="mb-3 text-xl font-semibold">{title}</h2>
      {albums.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {albums.map((album) => (
            <Link key={album.id} href={`/albums/${album.id}`}>
              <Card className="overflow-hidden p-0">
                {album.coverPhotoId ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/thumbnails/${album.coverPhotoId}`}
                    alt={album.name}
                    loading="lazy"
                    className="aspect-square w-full object-cover"
                  />
                ) : (
                  <div className="aspect-square w-full bg-muted" />
                )}
                <div className="p-3">
                  <p className="truncate font-medium">{album.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {album.photoCount} {album.photoCount === 1 ? "photo" : "photos"}
                  </p>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
