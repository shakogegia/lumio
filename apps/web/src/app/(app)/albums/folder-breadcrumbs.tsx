"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { FolderDTO } from "@lumio/shared";

/** "Albums › Europe › Italy" trail. The last crumb is the current (non-link) folder. */
export function FolderBreadcrumbs({ breadcrumbs }: { breadcrumbs: FolderDTO[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1 text-sm text-muted-foreground">
      <Link href="/albums" className="rounded px-1 hover:text-foreground">
        Albums
      </Link>
      {breadcrumbs.map((crumb, i) => {
        const isLast = i === breadcrumbs.length - 1;
        return (
          <span key={crumb.id} className="flex items-center gap-1">
            <ChevronRight className="size-3.5" aria-hidden />
            {isLast ? (
              <span className="px-1 font-medium text-foreground">{crumb.name}</span>
            ) : (
              <Link href={`/albums/folder/${crumb.id}`} className="rounded px-1 hover:text-foreground">
                {crumb.name}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
