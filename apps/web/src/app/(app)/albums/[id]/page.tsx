import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAlbum } from "@/lib/albums-service";
import { AlbumView } from "./album-view";

export const dynamic = "force-dynamic";

// `cache` dedupes the lookup so generateMetadata and the page share one query.
const loadAlbum = cache((id: string) => getAlbum(id));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const album = await loadAlbum(id);
  return { title: album?.name ?? "Album" };
}

export default async function AlbumDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const album = await loadAlbum(id);
  if (!album) notFound();

  return (
    <main className="w-full px-4 pb-6">
      <AlbumView albumId={album.id} albumName={album.name} isSmart={album.isSmart} />
    </main>
  );
}
