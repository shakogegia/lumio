"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Folder, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CreateCatalogDialog } from "@/components/create-catalog-dialog";
import { catalogPath } from "@/lib/catalog-api";
import { RenameCatalogDialog } from "./rename-catalog-dialog";
import { DeleteCatalogDialog } from "./delete-catalog-dialog";

export interface CatalogRow {
  id: string;
  slug: string;
  name: string;
  path: string;
  photoCount: number;
}

function plural(n: number) {
  return n === 1 ? "" : "s";
}

/**
 * Client surface for the `/catalogs` page: the "New catalog" button plus a row
 * per catalog with a Rename/Delete action menu. Creating navigates straight into
 * the new catalog (the natural next step); rename/delete refresh the RSC list.
 * The rename/delete dialogs are rendered once and targeted at whichever row is
 * active so their open state lives here rather than per-row.
 */
export function CatalogsList({ rows }: { rows: CatalogRow[] }) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<CatalogRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CatalogRow | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus data-icon="inline-start" aria-hidden />
          New catalog
        </Button>
      </div>

      <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-muted/40">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex items-center gap-4 px-4 py-3.5"
            data-slot="catalog-row"
          >
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="truncate text-sm font-medium text-foreground">
                {row.name}
              </div>
              <code className="block truncate font-mono text-xs text-muted-foreground">
                {row.path}
              </code>
            </div>

            <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
              {row.photoCount.toLocaleString()} photo{plural(row.photoCount)}
            </span>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Actions for ${row.name}`}
                >
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setRenameTarget(row)}>
                  <Pencil aria-hidden />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setDeleteTarget(row)}
                >
                  <Trash2 aria-hidden />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground">
            <Folder className="size-6 opacity-50" aria-hidden />
            No catalogs yet. Create one to get started.
          </li>
        )}
      </ul>

      <CreateCatalogDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(catalog) =>
          router.push(catalogPath(catalog.slug, "/photos"))
        }
      />

      <RenameCatalogDialog
        catalog={renameTarget}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
        onRenamed={() => {
          setRenameTarget(null);
          router.refresh();
        }}
      />

      <DeleteCatalogDialog
        catalog={deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onDeleted={() => {
          setDeleteTarget(null);
          router.refresh();
        }}
      />
    </div>
  );
}
