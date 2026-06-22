import { Fragment } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { catalogBreadcrumbs } from "@/lib/catalog-fs";
import { catalogPath } from "@/lib/catalog-api";

function folderHref(slug: string, rel: string): string {
  const base = catalogPath(slug, "/folders");
  return rel ? `${base}?path=${encodeURIComponent(rel)}` : base;
}

/** "Library › 2024 › trip" trail for the folders header (matches /albums style). */
export function FolderBreadcrumb({ slug, rel }: { slug: string; rel: string }) {
  const crumbs = catalogBreadcrumbs(rel); // [{name:"Library",rel:""}, …]
  return (
    <span className="flex items-center gap-1">
      {crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <Fragment key={c.rel}>
            {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
            {isLast ? (
              <span className="truncate">{c.name}</span>
            ) : (
              <Link href={folderHref(slug, c.rel)} className="font-normal text-muted-foreground hover:text-foreground">
                {c.name}
              </Link>
            )}
          </Fragment>
        );
      })}
    </span>
  );
}
