import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { parseDetailScope } from "@/lib/photo-detail-loader";
import { getPhoto } from "@/lib/photos-service";
import { locatePhoto } from "@/lib/locate-photo";
import { PhotoCollectionProvider } from "@/components/photo-grid/photo-collection";
import { PhotoGrid } from "@/components/photo-grid/photo-grid";
import { Lightbox } from "@/components/photo-grid/lightbox";

export const dynamic = "force-dynamic";

// `cache` dedupes the lookup so generateMetadata and the page share one query.
const loadPhoto = cache((id: string) => getPhoto(id));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const photo = await loadPhoto(id);
  // Title the tab with the file's basename (e.g. "IMG_1234.jpg"); fall back to "Photo".
  const name = photo?.path.split("/").pop();
  return { title: name || "Photo" };
}

export default async function PhotoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ album?: string | string[]; q?: string; s?: string; sort?: string }>;
}) {
  const { id } = await params;
  const scope = parseDetailScope(await searchParams);
  const [photo, index] = await Promise.all([loadPhoto(id), locatePhoto(id, scope)]);
  if (!photo || index === null) notFound();

  return (
    <main className="w-full px-6 pb-6">
      {/* Grid renders behind the lightbox; closing lands here scrolled into place.
          `scope` is a plain (serializable) object — the provider derives the
          endpoint/params/urlForId/baseUrl from it on the client, so no function
          crosses the Server→Client boundary. */}
      <PhotoCollectionProvider scope={scope} initialIndex={index} initialPhoto={photo}>
        <PhotoGrid />
        <Lightbox />
      </PhotoCollectionProvider>
    </main>
  );
}
