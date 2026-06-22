import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isFeatureEnabled } from "@lumio/db";
import { FeatureKey } from "@lumio/shared";
import { getCatalogForSlug } from "@/lib/active-catalog";
import { readCatalogDir } from "@/lib/catalog-fs-service";
import type { CatalogListing } from "@/lib/catalog-fs";
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
  const catalog = await getCatalogForSlug(slug); // 404 if unknown
  if (!(await isFeatureEnabled(catalog.id, FeatureKey.DiskExplorer))) notFound();

  const sp = await searchParams;
  const rel = typeof sp.path === "string" ? sp.path : "";

  let listing: CatalogListing;
  try {
    listing = await readCatalogDir(catalog, rel);
  } catch {
    notFound(); // traversal escape or missing directory
  }

  return (
    <main className="w-full px-4 pb-6">
      <FolderExplorer slug={slug} listing={listing} />
    </main>
  );
}
