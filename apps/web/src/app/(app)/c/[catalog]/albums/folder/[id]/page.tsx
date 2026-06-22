import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { listFolderContents } from "@/lib/folders-service";
import { getCatalogForSlug } from "@/lib/active-catalog";
import { FolderBrowser } from "../../folder-browser";

export const dynamic = "force-dynamic";

const loadContents = cache((catalogId: string, id: string) =>
  listFolderContents(catalogId, id),
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ catalog: string; id: string }>;
}): Promise<Metadata> {
  const { catalog: slug, id } = await params;
  const catalog = await getCatalogForSlug(slug);
  const contents = await loadContents(catalog.id, id);
  return { title: contents?.folder?.name ?? "Folder" };
}

export default async function FolderPage({
  params,
}: {
  params: Promise<{ catalog: string; id: string }>;
}) {
  const { catalog: slug, id } = await params;
  const catalog = await getCatalogForSlug(slug);
  const contents = await loadContents(catalog.id, id);
  if (!contents) notFound();

  return (
    <main className="w-full px-4 pb-6">
      <FolderBrowser contents={contents} />
    </main>
  );
}
