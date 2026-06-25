import type { Metadata } from "next";
import type { ShareLinkSummaryDTO } from "@lumio/shared";
import { getCatalogForSlug } from "@/lib/server/active-catalog";
import { getPublicBaseUrl } from "@/lib/server/app-settings-service";
import { listShareLinks } from "@/lib/server/share-links-service";
import { SharedLinksList } from "./shared-links-list";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shared" };

export default async function SharedPage({ params }: { params: Promise<{ catalog: string }> }) {
  const { catalog: slug } = await params;
  const catalog = await getCatalogForSlug(slug);
  const baseUrl = (await getPublicBaseUrl()) ?? "";
  const links: ShareLinkSummaryDTO[] = await listShareLinks(catalog.id, baseUrl);

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-4 py-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Shared links</h1>
        <p className="text-sm text-muted-foreground">
          Public links to selected photos. Anyone with a link can view and download.
        </p>
      </div>
      <SharedLinksList slug={slug} rows={links} />
    </main>
  );
}
