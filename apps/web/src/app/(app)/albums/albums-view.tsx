"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FolderOpen } from "lucide-react";
import { toast } from "sonner";
import type { AlbumSummaryDTO } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { HeaderBar } from "@/components/header-bar";
import { GridSizeMenu } from "@/components/grid-size-menu";
import { SelectionToolbar } from "@/app/(app)/photos/selection-toolbar";
import { useGridSelection } from "@/lib/use-grid-selection";
import { useAlbumColumns } from "@/lib/use-album-columns";
import { useConfirm } from "@/components/confirm-dialog";
import { partitionAlbums } from "@/lib/partition-albums";
import { NewAlbumDialog } from "./new-album-dialog";
import { AlbumCard } from "./album-card";

export function AlbumsView({ albums }: { albums: AlbumSummaryDTO[] }) {
  const router = useRouter();
  const sel = useGridSelection();
  const { columns, setColumns } = useAlbumColumns();
  const { confirm, confirmDialog } = useConfirm();
  const [deleting, setDeleting] = useState(false);

  const { regular, smart } = partitionAlbums(albums);

  function toggle(id: string) {
    sel.setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleDelete() {
    const ids = [...sel.selected];
    if (ids.length === 0 || deleting) return;
    const label = `${ids.length} ${ids.length === 1 ? "album" : "albums"}`;
    const ok = await confirm({
      title: `Delete ${label}?`,
      description: "This can't be undone. The photos stay in your library.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/albums", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error("delete failed");
      sel.cancel();
      router.refresh();
    } catch {
      toast.error("Failed to delete albums.");
    } finally {
      setDeleting(false);
    }
  }

  if (albums.length === 0) {
    return (
      <>
        {confirmDialog}
        <HeaderBar title="Albums" actions={<NewAlbumDialog />} />
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderOpen />
            </EmptyMedia>
            <EmptyTitle>No albums yet</EmptyTitle>
            <EmptyDescription>Create an album to group your photos.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </>
    );
  }

  return (
    <>
      {confirmDialog}
      {sel.selectMode ? (
        <SelectionToolbar
          title="Select albums"
          count={sel.count}
          onCancel={sel.cancel}
          actions={
            <Button
              variant="destructive"
              size="sm"
              disabled={sel.count === 0 || deleting}
              onClick={() => void handleDelete()}
            >
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          }
        />
      ) : (
        <HeaderBar
          title="Albums"
          actions={
            <>
              <GridSizeMenu columns={columns} onColumnsChange={setColumns} />
              <Button variant="outline" size="sm" onClick={sel.enter}>
                Select
              </Button>
              <NewAlbumDialog />
            </>
          }
        />
      )}

      <div className="space-y-8">
        {regular.length > 0 && (
          <AlbumSection
            title="Albums"
            albums={regular}
            columns={columns}
            selectMode={sel.selectMode}
            selected={sel.selected}
            onToggle={toggle}
          />
        )}
        {smart.length > 0 && (
          <AlbumSection
            title="Smart Albums"
            albums={smart}
            columns={columns}
            selectMode={sel.selectMode}
            selected={sel.selected}
            onToggle={toggle}
          />
        )}
      </div>
    </>
  );
}

function AlbumSection({
  title,
  albums,
  columns,
  selectMode,
  selected,
  onToggle,
}: {
  title: string;
  albums: AlbumSummaryDTO[];
  columns: number;
  selectMode: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{title}</h2>
      <div
        className="grid gap-x-5 gap-y-7"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {albums.map((album) => (
          <AlbumCard
            key={album.id}
            album={album}
            selectMode={selectMode}
            isSelected={selected.has(album.id)}
            onToggle={onToggle}
          />
        ))}
      </div>
    </section>
  );
}
