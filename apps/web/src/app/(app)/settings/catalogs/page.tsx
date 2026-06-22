import type { Metadata } from "next";
import { listCatalogs } from "@lumio/db";
import { getCatalogStats } from "@/lib/status-service";
import { CatalogsList, type CatalogRow } from "./catalogs-list";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Catalogs" };

/**
 * Catalogs management (settings section). Lists every catalog in custom order;
 * rows are drag-reorderable and link into per-catalog settings. This RSC loads
 * catalogs + stats and hands a serializable shape to {@link CatalogsList}.
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
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Catalogs</h1>
        <p className="text-sm text-muted-foreground">
          Each catalog is a separate photo library with its own folder, albums, and edits.
          Drag to reorder.
        </p>
      </div>

      <CatalogsList rows={rows} />
    </main>
  );
}
