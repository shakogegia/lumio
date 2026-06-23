import type { Metadata } from "next";
import { listFolderContents } from "@/lib/server/folders-service";
import { getCatalogForSlug } from "@/lib/server/active-catalog";
import { FolderBrowser } from "./album-folder-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Albums" };

export default async function AlbumsPage({
  params,
}: {
  params: Promise<{ catalog: string }>;
}) {
  const { catalog: slug } = await params;
  const catalog = await getCatalogForSlug(slug);
  const contents = await listFolderContents(catalog.id, null);

  return (
    <main className="w-full px-4 pb-6">
      {/* contents is never null for the top level */}
      <FolderBrowser contents={contents!} />
    </main>
  );
}
