import type { Metadata } from "next";
import { getAlbum } from "@/lib/server/albums-service";
import { getCatalogForSlug } from "@/lib/server/active-catalog";
import { UploadClient } from "./upload-client";

export const metadata: Metadata = { title: "Upload" };
export const dynamic = "force-dynamic";

export default async function UploadPage({
  params,
  searchParams,
}: {
  params: Promise<{ catalog: string }>;
  searchParams: Promise<{ albumId?: string | string[] }>;
}) {
  const { catalog: slug } = await params;
  const catalog = await getCatalogForSlug(slug);

  const { albumId } = await searchParams;
  const id = Array.isArray(albumId) ? albumId[0] : albumId;

  // Resolve the destination album server-side: keeps its name out of the URL
  // and never stale. Unknown ids and smart albums fall back to a plain upload.
  let targetAlbum: { id: string; name: string } | undefined;
  if (id) {
    const album = await getAlbum(catalog.id, id);
    if (album && !album.isSmart) {
      targetAlbum = { id: album.id, name: album.name };
    }
  }

  return (
    <main className="w-full px-4 pb-6">
      <UploadClient targetAlbum={targetAlbum} />
    </main>
  );
}
