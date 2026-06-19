import { listAlbumSummaries } from "@/lib/albums-service";
import { AlbumsView } from "./albums-view";

export const dynamic = "force-dynamic";

export default async function AlbumsPage() {
  const albums = await listAlbumSummaries();

  return (
    <main className="w-full px-6 pb-6">
      <AlbumsView albums={albums} />
    </main>
  );
}
