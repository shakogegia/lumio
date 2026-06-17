import type { AlbumDTO } from "@lumio/shared";
import { listAlbums } from "@/lib/albums-service";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function AlbumsPage() {
  const albums = await listAlbums();
  const regular = albums.filter((a) => !a.isSmart);
  const smart = albums.filter((a) => a.isSmart);

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-4">
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
  albums: AlbumDTO[];
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
            <Card key={album.id} className="p-4">
              <p className="font-medium">{album.name}</p>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
