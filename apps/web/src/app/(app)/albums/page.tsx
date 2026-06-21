import type { Metadata } from "next";
import { listAlbumSummaries } from "@/lib/albums-service";
import { AlbumsView } from "./albums-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Albums" };

export default async function AlbumsPage() {
  const albums = await listAlbumSummaries();

  return (
    <main className="w-full px-4 pb-6">
      <AlbumsView albums={albums} />
    </main>
  );
}
