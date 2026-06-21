import type { Metadata } from "next";
import { getAlbum } from "@/lib/albums-service";
import { UploadClient } from "./upload-client";

export const metadata: Metadata = { title: "Upload" };
export const dynamic = "force-dynamic";

export default async function UploadPage({
  searchParams,
}: {
  searchParams: Promise<{ albumId?: string | string[] }>;
}) {
  const { albumId } = await searchParams;
  const id = Array.isArray(albumId) ? albumId[0] : albumId;

  // Resolve the destination album server-side: keeps its name out of the URL
  // and never stale. Unknown ids and smart albums fall back to a plain upload.
  let targetAlbum: { id: string; name: string } | undefined;
  if (id) {
    const album = await getAlbum(id);
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
