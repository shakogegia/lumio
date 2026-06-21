import { notFound } from "next/navigation";
import { getFolder } from "@/lib/folders-service";
import { FolderPhotosView } from "./folder-photos-view";

export const dynamic = "force-dynamic";

export default async function FolderPhotosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const folder = await getFolder(id);
  if (!folder) notFound();

  return (
    <main className="w-full px-4 pb-6">
      <FolderPhotosView folderId={folder.id} folderName={folder.name} />
    </main>
  );
}
