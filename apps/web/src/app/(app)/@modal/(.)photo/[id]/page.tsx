import { notFound } from "next/navigation";
import { RouteOverlay } from "@/components/route-overlay";
import { loadPhotoDetail } from "@/lib/photo-detail-loader";
import { PhotoDetail } from "@/app/(app)/photo/[id]/photo-detail";

export const dynamic = "force-dynamic";

export default async function PhotoIntercept({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ album?: string }>;
}) {
  const { id } = await params;
  const { album } = await searchParams;
  const data = await loadPhotoDetail(id, album ?? null);
  if (!data) notFound();

  return (
    <RouteOverlay>
      <PhotoDetail
        photo={data.photo}
        regularAlbums={data.regularAlbums}
        neighbors={data.neighbors}
        albumId={album ?? null}
        overlay
      />
    </RouteOverlay>
  );
}
