"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronRight, Folder, GripVertical, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
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

/** Move `id` so it sits immediately after `afterId` (null = front) in a copy of `rows`. */
function moveAfter(rows: CatalogRow[], id: string, afterId: string | null): CatalogRow[] {
  const moved = rows.find((r) => r.id === id);
  if (!moved) return rows;
  const without = rows.filter((r) => r.id !== id);
  const at = afterId === null ? 0 : without.findIndex((r) => r.id === afterId) + 1;
  return [...without.slice(0, at), moved, ...without.slice(at)];
}

/**
 * Client surface for `/settings/catalogs`: a drag-reorderable list (native HTML5
 * DnD), each row linking into per-catalog settings, plus New/Rename/Delete.
 * Reorder is optimistic — we resequence the local array on drop and persist a
 * single "move after X" to the API; on failure we revert to the server order.
 */
export function CatalogsList({ rows }: { rows: CatalogRow[] }) {
  const router = useRouter();
  const [items, setItems] = useState(rows);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<CatalogRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CatalogRow | null>(null);

  // Resync when the server list changes (create/rename/delete/refresh).
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setItems(rows);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [rows]);

  async function persistOrder(next: CatalogRow[], movedId: string) {
    const idx = next.findIndex((r) => r.id === movedId);
    const afterId = idx > 0 ? next[idx - 1]!.id : null;
    try {
      const res = await fetch(`/api/catalogs/${movedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ afterId }),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setItems(rows); // immediate revert to the last-known server order
      toast.error("Couldn't save the new order");
      router.refresh(); // reconcile with the server in case it changed mid-flight
    }
  }

  function onDragStart(id: string) {
    setDraggingId(id);
  }

  function onDragOverRow(targetId: string) {
    if (!draggingId || draggingId === targetId) return;
    setItems((cur) => {
      const di = cur.findIndex((r) => r.id === draggingId);
      const ti = cur.findIndex((r) => r.id === targetId);
      if (di === -1 || ti === -1) return cur;
      // Place the dragged row immediately before the row it's hovering.
      const afterId = ti > 0 ? cur[ti - 1]!.id : null;
      if (afterId === draggingId) return cur; // already in place
      return moveAfter(cur, draggingId, afterId);
    });
  }

  function onDragEnd() {
    const moved = draggingId;
    setDraggingId(null);
    if (!moved) return;
    // Only persist if the order actually changed vs. the server snapshot.
    const changed = items.some((r, i) => r.id !== rows[i]?.id);
    if (changed) void persistOrder(items, moved);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus data-icon="inline-start" aria-hidden />
          New catalog
        </Button>
      </div>

      {items.length > 0 ? (
        <ItemGroup className="gap-2.5">
          {items.map((row) => (
            <Item
              key={row.id}
              variant="outline"
              draggable
              onDragStart={() => onDragStart(row.id)}
              onDragOver={(e) => {
                e.preventDefault();
                onDragOverRow(row.id);
              }}
              onDragEnd={onDragEnd}
              className={cn(draggingId === row.id && "opacity-50")}
            >
              <button
                type="button"
                aria-label={`Drag to reorder ${row.name}`}
                className="cursor-grab text-muted-foreground/60 transition-colors hover:text-foreground active:cursor-grabbing"
                // The whole Item is draggable; this handle is just the affordance.
                tabIndex={-1}
              >
                <GripVertical className="size-4" aria-hidden />
              </button>

              <Link
                href={`/settings/catalogs/${row.id}`}
                className="flex min-w-0 flex-1 items-center gap-4 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ItemContent className="min-w-0">
                  <ItemTitle className="truncate">{row.name}</ItemTitle>
                  <ItemDescription className="truncate font-mono text-xs">
                    {row.path}
                  </ItemDescription>
                </ItemContent>
                <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                  {row.photoCount.toLocaleString()} photo{plural(row.photoCount)}
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />
              </Link>

              <ItemActions>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${row.name}`}>
                      <MoreHorizontal aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setRenameTarget(row)}>
                      <Pencil aria-hidden />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={() => setDeleteTarget(row)}>
                      <Trash2 aria-hidden />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-border px-4 py-10 text-center text-sm text-muted-foreground">
          <Folder className="size-6 opacity-50" aria-hidden />
          No catalogs yet. Create one to get started.
        </div>
      )}

      <CreateCatalogDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(catalog) => router.push(catalogPath(catalog.slug, "/photos"))}
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
