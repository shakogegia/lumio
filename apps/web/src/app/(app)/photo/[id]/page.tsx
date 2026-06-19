import { notFound } from "next/navigation";
import { detailScopeQuery, loadPhotoDetail, parseDetailScope } from "@/lib/photo-detail-loader";
import { PhotoDetail } from "./photo-detail";

export const dynamic = "force-dynamic";

export default async function PhotoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ album?: string | string[]; q?: string; s?: string }>;
}) {
  const { id } = await params;
  const scope = parseDetailScope(await searchParams);
  const data = await loadPhotoDetail(id, scope);
  if (!data) notFound();

  return (
    <main>
      <PhotoDetail
        photo={data.photo}
        regularAlbums={data.regularAlbums}
        neighbors={data.neighbors}
        scope={detailScopeQuery(scope)}
      />
    </main>
  );
}
