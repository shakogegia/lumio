import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { listFolderContents } from "@/lib/folders-service";
import { FolderBrowser } from "../../folder-browser";

export const dynamic = "force-dynamic";

const loadContents = cache((id: string) => listFolderContents(id));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const contents = await loadContents(id);
  return { title: contents?.folder?.name ?? "Folder" };
}

export default async function FolderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const contents = await loadContents(id);
  if (!contents) notFound();

  return (
    <main className="w-full px-4 pb-6">
      <FolderBrowser contents={contents} />
    </main>
  );
}
