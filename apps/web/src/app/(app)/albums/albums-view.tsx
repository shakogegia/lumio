"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FolderOpen, Loader2, Trash2 } from "lucide-react";
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
import { ALBUM_DEFAULT_COLUMNS } from "@/lib/grid-layout";
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

  function open(id: string) {
    router.push(`/albums/${id}`);
  }

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
      sel.clear();
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
      {sel.count > 0 ? (
        <SelectionToolbar
          title="Select albums"
          count={sel.count}
          onCancel={sel.clear}
          actions={
            <Button
              variant="destructive"
              size="icon-sm"
              disabled={sel.count === 0 || deleting}
              onClick={() => void handleDelete()}
              aria-label="Delete"
              title="Delete"
            >
              {deleting ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
            </Button>
          }
        />
      ) : (
        <HeaderBar
          title="Albums"
          actions={
            <>
              <GridSizeMenu columns={columns} onColumnsChange={setColumns} />
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
            selected={sel.selected}
            onToggle={toggle}
            onOpen={open}
          />
        )}
        {smart.length > 0 && (
          <AlbumSection
            title="Smart Albums"
            albums={smart}
            selected={sel.selected}
            onToggle={toggle}
            onOpen={open}
          />
        )}
      </div>
    </>
  );
}

function AlbumSection({
  title,
  albums,
  selected,
  onToggle,
  onOpen,
}: {
  title: string;
  albums: AlbumSummaryDTO[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{title}</h2>
      {/* Column count comes from the --album-columns CSS variable (set live by
          useAlbumColumns and pre-paint by the root layout), so the server-
          rendered grid paints at the chosen density with no hydration flash. */}
      <div
        className="grid gap-x-5 gap-y-7"
        style={{
          gridTemplateColumns: `repeat(var(--album-columns, ${ALBUM_DEFAULT_COLUMNS}), minmax(0, 1fr))`,
        }}
      >
        {albums.map((album) => (
          <AlbumCard
            key={album.id}
            album={album}
            isSelected={selected.has(album.id)}
            onToggle={onToggle}
            onOpen={onOpen}
          />
        ))}
      </div>
    </section>
  );
}
