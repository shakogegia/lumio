import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { parseDetailScope } from "@/lib/photo-detail-loader";
import { getPhoto } from "@/lib/photos-service";
import { locatePhoto } from "@/lib/locate-photo";
import { getCatalogForSlug } from "@/lib/active-catalog";
import { PhotoCollectionProvider, PhotoGrid } from "@/features/photo-grid";
import { Lightbox } from "@/features/lightbox";

export const dynamic = "force-dynamic";

// `cache` dedupes the lookup so generateMetadata and the page share one query.
const loadPhoto = cache((catalogId: string, id: string) => getPhoto(catalogId, id));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ catalog: string; id: string }>;
}): Promise<Metadata> {
  const { catalog: slug, id } = await params;
  const catalog = await getCatalogForSlug(slug);
  const photo = await loadPhoto(catalog.id, id);
  // Title the tab with the file's basename (e.g. "IMG_1234.jpg"); fall back to "Photo".
  const name = photo?.path.split("/").pop();
  return { title: name || "Photo" };
}

export default async function PhotoPage({
  params,
  searchParams,
}: {
  params: Promise<{ catalog: string; id: string }>;
  searchParams: Promise<{
    album?: string | string[];
    q?: string;
    s?: string;
    sort?: string;
    folder?: string;
  }>;
}) {
  const { catalog: slug, id } = await params;
  const catalog = await getCatalogForSlug(slug);
  const scope = parseDetailScope(await searchParams);
  const [photo, index] = await Promise.all([
    loadPhoto(catalog.id, id),
    locatePhoto(catalog.id, id, scope),
  ]);
  if (!photo || index === null) notFound();

  return (
    <main className="w-full px-4 pb-6">
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
