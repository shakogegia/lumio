"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import type { FolderDTO } from "@lumio/shared";
import { cn } from "@/lib/utils";

function Crumb({ id, children, href }: { id: string | null; children: React.ReactNode; href: string }) {
  const { setNodeRef, isOver } = useDroppable({
    id: id === null ? "drop:root" : `drop:${id}`,
    data: { type: "folder", id },
  });
  return (
    <Link
      ref={setNodeRef}
      href={href}
      className={cn("rounded px-1 hover:text-foreground", isOver && "bg-primary/15 text-foreground")}
    >
      {children}
    </Link>
  );
}

export function FolderBreadcrumbs({ breadcrumbs }: { breadcrumbs: FolderDTO[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1 text-sm text-muted-foreground">
      <Crumb id={null} href="/albums">
        Albums
      </Crumb>
      {breadcrumbs.map((crumb, i) => {
        const isLast = i === breadcrumbs.length - 1;
        return (
          <span key={crumb.id} className="flex items-center gap-1">
            <ChevronRight className="size-3.5" aria-hidden />
            {isLast ? (
              <span className="px-1 font-medium text-foreground">{crumb.name}</span>
            ) : (
              <Crumb id={crumb.id} href={`/albums/folder/${crumb.id}`}>
                {crumb.name}
              </Crumb>
            )}
          </span>
        );
      })}
    </nav>
  );
}
