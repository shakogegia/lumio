import type { Metadata } from "next";
import type { ShareLinkSummaryDTO } from "@lumio/shared";
import { getCatalogForSlug } from "@/lib/server/active-catalog";
import { getPublicBaseUrl } from "@/lib/server/app-settings-service";
import { listShareLinks } from "@/lib/server/share-links-service";
import { SharedLinksGrid } from "./shared-links-grid";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shared" };

export default async function SharedPage({ params }: { params: Promise<{ catalog: string }> }) {
  const { catalog: slug } = await params;
  const catalog = await getCatalogForSlug(slug);
  const baseUrl = (await getPublicBaseUrl()) ?? "";
  const links: ShareLinkSummaryDTO[] = await listShareLinks(catalog.id, baseUrl);

  return (
    <main className="w-full px-4 pb-6">
      <SharedLinksGrid slug={slug} rows={links} />
    </main>
  );
}
