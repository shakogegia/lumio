import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { listCatalogs } from "@lumio/db";
import { getCatalogStats } from "@/lib/status-service";
import { CatalogsList, type CatalogRow } from "./catalogs-list";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Catalogs" };

/**
 * Global (catalog-agnostic) management page for every catalog. Session-gated by
 * `(app)/layout`; it has no catalog sidebar, so a back link to `/` (which
 * redirects into a catalog) keeps the user from being stranded. The list +
 * per-row actions live in {@link CatalogsList} (client); this RSC just loads the
 * catalogs and their stats and hands down a serializable shape.
 */
export default async function CatalogsPage() {
  const catalogs = await listCatalogs();
  const rows: CatalogRow[] = await Promise.all(
    catalogs.map(async (c) => {
      const stats = await getCatalogStats(c.id);
      return {
        id: c.id,
        slug: c.slug,
        name: c.name,
        path: c.path,
        photoCount: stats.photoCount,
      };
    }),
  );

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-4 py-8">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to photos
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Catalogs</h1>
          <p className="text-sm text-muted-foreground">
            Each catalog is a separate photo library with its own folder, albums,
            and edits.
          </p>
        </div>
      </div>

      <CatalogsList rows={rows} />
    </main>
  );
}
