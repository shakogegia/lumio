"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Images } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useGridSelection } from "@/lib/use-grid-selection";
import { useGridView } from "@/lib/use-grid-view";
import { GridViewMenu } from "@/components/grid-view-menu";
import { PhotoGrid } from "@/components/photo-grid/photo-grid";
import { SelectionToolbar } from "@/app/(app)/photos/selection-toolbar";
import { AddToAlbumDialog } from "@/app/(app)/photos/add-to-album-dialog";
import { HeaderBar } from "@/components/header-bar";
import { useConfirm } from "@/components/confirm-dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { DeleteAlbumButton } from "./delete-album-button";

export function AlbumView({
  albumId,
  albumName,
  isSmart,
}: {
  albumId: string;
  albumName: string;
  isSmart: boolean;
}) {
  const router = useRouter();
  const sel = useGridSelection();
  const { mode, setMode } = useGridView();
  const { confirm, confirmDialog } = useConfirm();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  function handleCancel() {
    setRemoveError(null);
    sel.cancel();
  }

  async function handleRemove() {
    const ids = [...sel.selected];
    if (ids.length === 0 || removing) return;
    const label = `${ids.length} ${ids.length === 1 ? "photo" : "photos"}`;
    const ok = await confirm({
      title: `Remove ${label} from this album?`,
      description: "The photos stay in your library and Trash is unaffected.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      const res = await fetch(`/api/albums/${albumId}/photos`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ photoIds: ids }),
      });
      if (res.ok) {
        sel.cancel();
        setReloadKey((k) => k + 1);
        router.refresh();
      } else {
        setRemoveError("Failed to remove photos from this album.");
      }
    } catch {
      setRemoveError("Failed to remove photos from this album.");
    } finally {
      setRemoving(false);
    }
  }

  async function handleDelete() {
    const ids = [...sel.selected];
    if (ids.length === 0 || deleting) return;
    const label = `${ids.length} ${ids.length === 1 ? "photo" : "photos"}`;
    const ok = await confirm({
      title: `Move ${label} to Trash?`,
      description: "This removes them from your whole library. You can restore them from Trash.",
      confirmLabel: "Move to Trash",
      destructive: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/photos/trash", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error("trash failed");
      sel.cancel();
      setReloadKey((k) => k + 1);
      router.refresh();
    } catch {
      // Delete is a whole-library op (not album membership), so surface its
      // failure as a toast like the library view rather than the album's
      // inline "remove from album" error slot.
      toast.error("Failed to move photos to Trash.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      {confirmDialog}
      {sel.selectMode ? (
        <SelectionToolbar
          title={albumName}
          count={sel.count}
          onCancel={handleCancel}
          actions={
            <>
              <Button size="sm" disabled={sel.count === 0} onClick={() => setDialogOpen(true)}>
                Add to album
              </Button>
              {!isSmart && (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={sel.count === 0 || removing}
                  onClick={() => void handleRemove()}
                >
                  {removing ? "Removing…" : "Remove from album"}
                </Button>
              )}
              <Button
                variant="destructive"
                size="sm"
                disabled={sel.count === 0 || deleting}
                onClick={() => void handleDelete()}
              >
                {deleting ? "Deleting…" : "Delete"}
              </Button>
            </>
          }
        />
      ) : (
        <HeaderBar
          title={albumName}
          actions={
            <>
              <GridViewMenu mode={mode} onModeChange={setMode} />
              <Button variant="outline" size="sm" onClick={sel.enter}>
                Select
              </Button>
              <DeleteAlbumButton albumId={albumId} />
            </>
          }
        />
      )}

      {removeError && (
        <p className="mb-4 text-sm text-destructive">{removeError}</p>
      )}

      <PhotoGrid
        key={reloadKey}
        endpoint={`/api/albums/${albumId}/photos`}
        albumId={albumId}
        mode={mode}
        selectMode={sel.selectMode}
        selectedIds={sel.selected}
        onSelectionChange={sel.setSelected}
        empty={
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Images />
              </EmptyMedia>
              <EmptyTitle>This album is empty</EmptyTitle>
              <EmptyDescription>
                Photos you add to this album will appear here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        }
      />

      <AddToAlbumDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        photoIds={[...sel.selected]}
        excludeAlbumId={albumId}
        onAdded={() => {
          setDialogOpen(false);
          sel.cancel();
        }}
      />
    </>
  );
}
