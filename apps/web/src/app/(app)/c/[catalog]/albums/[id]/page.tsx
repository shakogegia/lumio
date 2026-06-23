import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAlbum } from "@/lib/server/albums-service";
import { getCatalogForSlug } from "@/lib/server/active-catalog";
import { AlbumView } from "./album-view";

export const dynamic = "force-dynamic";

// `cache` dedupes the lookup so generateMetadata and the page share one query.
const loadAlbum = cache((catalogId: string, id: string) => getAlbum(catalogId, id));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ catalog: string; id: string }>;
}): Promise<Metadata> {
  const { catalog: slug, id } = await params;
  const catalog = await getCatalogForSlug(slug);
  const album = await loadAlbum(catalog.id, id);
  return { title: album?.name ?? "Album" };
}

export default async function AlbumDetailPage({
  params,
}: {
  params: Promise<{ catalog: string; id: string }>;
}) {
  const { catalog: slug, id } = await params;
  const catalog = await getCatalogForSlug(slug);
  const album = await loadAlbum(catalog.id, id);
  if (!album) notFound();

  return (
    <main className="w-full px-4 pb-6">
      <AlbumView
        albumId={album.id}
        albumName={album.name}
        isSmart={album.isSmart}
        coverPhotoId={album.coverPhotoId}
      />
    </main>
  );
}
