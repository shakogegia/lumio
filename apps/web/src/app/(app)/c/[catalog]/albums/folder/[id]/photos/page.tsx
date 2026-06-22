import { notFound } from "next/navigation";
import { getFolder } from "@/lib/folders-service";
import { getCatalogForSlug } from "@/lib/active-catalog";
import { FolderPhotosView } from "./folder-photos-view";

export const dynamic = "force-dynamic";

export default async function FolderPhotosPage({
  params,
}: {
  params: Promise<{ catalog: string; id: string }>;
}) {
  const { catalog: slug, id } = await params;
  const catalog = await getCatalogForSlug(slug);
  const folder = await getFolder(catalog.id, id);
  if (!folder) notFound();

  return (
    <main className="w-full px-4 pb-6">
      <FolderPhotosView folderId={folder.id} folderName={folder.name} />
    </main>
  );
}
