"use client";

import { useRef, useState } from "react";
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
  const [labelError, setLabelError] = useState(false);
  const [labelPending, setLabelPending] = useState(false);

  async function applyLabel(label: ColorLabel | null) {
    if (labelPending) return;
    const ids = sel.selected;
    setLabelPending(true);
    setLabelError(false);
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
      setLabelError(true);
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

      {labelError && (
        <p className="px-4 py-1 text-sm text-destructive">Failed to apply label.</p>
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
