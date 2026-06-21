import type { Metadata } from "next";
import { listFolderContents } from "@/lib/folders-service";
import { FolderBrowser } from "./folder-browser";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Albums" };

export default async function AlbumsPage() {
  const contents = await listFolderContents(null);

  return (
    <main className="w-full px-6 pb-6">
      {/* contents is never null for the top level */}
      <FolderBrowser contents={contents!} />
    </main>
  );
}
