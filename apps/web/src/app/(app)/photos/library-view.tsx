"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useGridSelection } from "@/lib/use-grid-selection";
import { useGridView } from "@/lib/use-grid-view";
import { GridViewMenu } from "@/components/grid-view-menu";
import { PhotoGrid, type PhotoGridHandle } from "@/components/photo-grid/photo-grid";
import { SelectionToolbar } from "./selection-toolbar";
import { AddToAlbumDialog } from "./add-to-album-dialog";
import { ColorLabelMenu } from "./color-label-menu";
import type { ColorLabel } from "@lumio/shared";
import { HeaderBar } from "@/components/header-bar";

export function LibraryView() {
  const sel = useGridSelection();
  const { mode, setMode } = useGridView();
  const [dialogOpen, setDialogOpen] = useState(false);
  const gridRef = useRef<PhotoGridHandle>(null);
  const [labelPending, setLabelPending] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    const ids = sel.selected;
    if (ids.size === 0 || deleting) return;
    const label = `${ids.size} ${ids.size === 1 ? "photo" : "photos"}`;
    if (!confirm(`Move ${label} to Trash?`)) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/photos/trash", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [...ids] }),
      });
      if (!res.ok) throw new Error("trash failed");
      // Drop the tiles in place (no remount) and leave select mode.
      gridRef.current?.removePhotos(ids);
      sel.cancel();
    } catch {
      toast.error("Failed to move photos to Trash.");
    } finally {
      setDeleting(false);
    }
  }

  async function applyLabel(label: ColorLabel | null) {
    if (labelPending) return;
    const ids = sel.selected;
    setLabelPending(true);
    try {
      const res = await fetch("/api/photos/color-label", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ photoIds: [...ids], label }),
      });
      if (!res.ok) throw new Error("label failed");
      // Optimistically repaint the client-fetched grid; selection stays so the
      // user sees the tint land and can re-pick.
      gridRef.current?.patchPhotos(ids, { colorLabel: label });
    } catch {
      toast.error("Failed to apply label.");
    } finally {
      setLabelPending(false);
    }
  }

  return (
    <>
      {sel.selectMode ? (
        <SelectionToolbar
          title="Select photos"
          count={sel.count}
          onCancel={sel.cancel}
          actions={
            <>
              <ColorLabelMenu
                disabled={sel.count === 0 || labelPending}
                onPick={(label) => void applyLabel(label)}
              />
              <Button size="sm" disabled={sel.count === 0} onClick={() => setDialogOpen(true)}>
                Add to album
              </Button>
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
          title="Library"
          actions={
            <>
              <GridViewMenu mode={mode} onModeChange={setMode} />
              <Button variant="outline" size="sm" onClick={sel.enter}>
                Select
              </Button>
            </>
          }
        />
      )}

      <PhotoGrid
        apiRef={gridRef}
        mode={mode}
        selectMode={sel.selectMode}
        selectedIds={sel.selected}
        onSelectionChange={sel.setSelected}
      />

      <AddToAlbumDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        photoIds={[...sel.selected]}
        onAdded={() => {
          setDialogOpen(false);
          sel.cancel();
        }}
      />
    </>
  );
}
