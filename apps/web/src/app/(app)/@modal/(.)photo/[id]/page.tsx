import { RouteOverlay } from "@/components/route-overlay";
import { detailScopeQuery, loadPhotoDetail, parseDetailScope } from "@/lib/photo-detail-loader";
import { PhotoDetail } from "@/app/(app)/photo/[id]/photo-detail";

export const dynamic = "force-dynamic";

export default async function PhotoIntercept({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ album?: string | string[]; q?: string; s?: string; sort?: string }>;
}) {
  const { id } = await params;
  const scope = parseDetailScope(await searchParams);
  const data = await loadPhotoDetail(id, scope);
  // This is the intercepting @modal slot, an overlay — not a full page. Parallel
  // slots keep their last segment on soft navigation, so router.refresh() (e.g.
  // after the danger zone deletes every photo) re-runs this loader for a photo
  // that no longer exists. notFound() here would swap the WHOLE page for a 404
  // until a hard reload. Render nothing instead — RouteOverlay already hides the
  // slot unless the URL is a /photo/[id] route. The full-page route still
  // notFound()s a missing photo, so deep links to a deleted photo 404 correctly.
  if (!data) return null;

  return (
    <RouteOverlay>
      <PhotoDetail
        photo={data.photo}
        regularAlbums={data.regularAlbums}
        neighbors={data.neighbors}
        scope={detailScopeQuery(scope)}
        overlay
      />
    </RouteOverlay>
  );
}
