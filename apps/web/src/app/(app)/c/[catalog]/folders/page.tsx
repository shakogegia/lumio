import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isFeatureEnabled } from "@lumio/db";
import { FeatureKey } from "@lumio/shared";
import { getCatalogForSlug } from "@/lib/server/active-catalog";
import { listSubfolderSummaries, type FolderSummary } from "@/lib/server/catalog-fs-service";
import { FolderExplorer } from "./folder-explorer";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Folders" };

export default async function FoldersPage({
  params,
  searchParams,
}: {
  params: Promise<{ catalog: string }>;
  searchParams: Promise<{ path?: string | string[] }>;
}) {
  const { catalog: slug } = await params;
  const catalog = await getCatalogForSlug(slug);
  if (!(await isFeatureEnabled(catalog.id, FeatureKey.DiskExplorer))) notFound();

  const sp = await searchParams;
  const rel = typeof sp.path === "string" ? sp.path : "";

  let subfolders: FolderSummary[];
  try {
    subfolders = await listSubfolderSummaries(catalog, rel);
  } catch {
    notFound(); // traversal escape or missing directory
  }

  return (
    <main className="w-full px-4 pb-6">
      <FolderExplorer rel={rel} subfolders={subfolders} />
    </main>
  );
}
