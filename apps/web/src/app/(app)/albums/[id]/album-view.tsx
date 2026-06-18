"use client";

import { useState } from "react";
import { Images } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGridSelection } from "@/lib/use-grid-selection";
import { PhotoGrid } from "@/app/(app)/photos/photo-grid";
import { SelectionToolbar } from "@/app/(app)/photos/selection-toolbar";
import { AddToAlbumDialog } from "@/app/(app)/photos/add-to-album-dialog";
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
  const sel = useGridSelection();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [removing, setRemoving] = useState(false);

  async function handleRemove() {
    const ids = [...sel.selected];
    if (ids.length === 0 || removing) return;
    const label = `${ids.length} ${ids.length === 1 ? "photo" : "photos"}`;
    if (!confirm(`Remove ${label} from this album?`)) return;
    setRemoving(true);
    try {
      const res = await fetch(`/api/albums/${albumId}/photos`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ photoIds: ids }),
      });
      if (res.ok) {
        sel.cancel();
        setReloadKey((k) => k + 1);
      }
    } finally {
      setRemoving(false);
    }
  }

  return (
    <>
      {sel.selectMode ? (
        <SelectionToolbar
          title={albumName}
          count={sel.count}
          onCancel={sel.cancel}
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
            </>
          }
        />
      ) : (
        <div className="mb-6 flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold">{albumName}</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={sel.enter}>
              Select
            </Button>
            <DeleteAlbumButton albumId={albumId} />
          </div>
        </div>
      )}

      <PhotoGrid
        key={reloadKey}
        endpoint={`/api/albums/${albumId}/photos`}
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
