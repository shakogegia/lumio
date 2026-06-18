"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useGridSelection } from "@/lib/use-grid-selection";
import { PhotoGrid } from "./photo-grid";
import { SelectionToolbar } from "./selection-toolbar";
import { AddToAlbumDialog } from "./add-to-album-dialog";
import { HeaderBar } from "@/components/header-bar";

export function LibraryView() {
  const sel = useGridSelection();
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      {sel.selectMode ? (
        <SelectionToolbar
          title="Select photos"
          count={sel.count}
          onCancel={sel.cancel}
          actions={
            <Button size="sm" disabled={sel.count === 0} onClick={() => setDialogOpen(true)}>
              Add to album
            </Button>
          }
        />
      ) : (
        <HeaderBar
          title="Library"
          actions={
            <Button variant="outline" size="sm" onClick={sel.enter}>
              Select
            </Button>
          }
        />
      )}

      <PhotoGrid
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
