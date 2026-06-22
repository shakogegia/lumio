import { Fragment } from "react";
import Link from "next/link";
import { ChevronRight, File as FileIcon, Folder as FolderIcon } from "lucide-react";
import { catalogApiUrl, catalogPath } from "@/lib/catalog-api";
import { catalogBreadcrumbs, type CatalogListing } from "@/lib/catalog-fs";
import { formatBytes } from "@/lib/format";

/** Build the /folders page href for a catalog-relative path ("" = root). */
function folderHref(slug: string, rel: string): string {
  const base = catalogPath(slug, "/folders");
  return rel ? `${base}?path=${encodeURIComponent(rel)}` : base;
}

/**
 * Presentational file-manager view: breadcrumb + subfolders + files. Indexed
 * photos render a thumbnail and link to the detail/lightbox; other files are
 * non-openable rows. Server component — no client state needed.
 */
export function FolderExplorer({
  slug,
  listing,
}: {
  slug: string;
  listing: CatalogListing;
}) {
  const crumbs = catalogBreadcrumbs(listing.rel);
  const isEmpty = listing.dirs.length === 0 && listing.files.length === 0;

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm">
        {crumbs.map((c, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <Fragment key={c.rel}>
              {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
              {isLast ? (
                <span className="font-medium text-foreground">{c.name}</span>
              ) : (
                <Link
                  href={folderHref(slug, c.rel)}
                  className="rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {c.name}
                </Link>
              )}
            </Fragment>
          );
        })}
      </nav>

      {isEmpty ? (
        <p className="text-sm text-muted-foreground">This folder is empty.</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          {listing.dirs.map((d) => (
            <Link
              key={d.rel}
              href={folderHref(slug, d.rel)}
              className="flex flex-col items-center gap-2 rounded-lg border border-border p-4 text-center transition-colors hover:bg-muted"
            >
              <FolderIcon className="size-10 text-muted-foreground" aria-hidden />
              <span className="w-full truncate text-sm font-medium">{d.name}</span>
            </Link>
          ))}

          {listing.files.map((f) =>
            f.photoId ? (
              <Link
                key={f.rel}
                href={catalogPath(slug, `/photo/${f.photoId}`)}
                className="group flex flex-col gap-2 rounded-lg border border-border p-2 transition-colors hover:bg-muted"
              >
                <span className="aspect-square w-full overflow-hidden rounded bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={catalogApiUrl(slug, `/photos/${f.photoId}/thumbnail`)}
                    alt={f.name}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </span>
                <span className="w-full truncate text-sm">{f.name}</span>
              </Link>
            ) : (
              <div
                key={f.rel}
                className="flex flex-col items-center gap-2 rounded-lg border border-border border-dashed p-4 text-center opacity-70"
              >
                <FileIcon className="size-10 text-muted-foreground" aria-hidden />
                <span className="w-full truncate text-sm">{f.name}</span>
                <span className="text-xs text-muted-foreground">{formatBytes(f.size)}</span>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
