import { notFound } from "next/navigation";
import { getPhoto } from "@/lib/photos-service";
import { PhotoDetail } from "./photo-detail";

export const dynamic = "force-dynamic";

export default async function PhotoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const photo = await getPhoto(id);
  if (!photo) notFound();

  return (
    <main className="mx-auto max-w-5xl p-4">
      <PhotoDetail photo={photo} />
    </main>
  );
}
