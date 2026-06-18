"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Images } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGridSelection } from "@/lib/use-grid-selection";
import { PhotoGrid } from "@/app/(app)/photos/photo-grid";
import { SelectionToolbar } from "@/app/(app)/photos/selection-toolbar";
import { AddToAlbumDialog } from "@/app/(app)/photos/add-to-album-dialog";
import { HeaderBar } from "@/components/header-bar";
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  function handleCancel() {
    setRemoveError(null);
    sel.cancel();
  }

  async function handleRemove() {
    const ids = [...sel.selected];
    if (ids.length === 0 || removing) return;
    const label = `${ids.length} ${ids.length === 1 ? "photo" : "photos"}`;
    if (!confirm(`Remove ${label} from this album?`)) return;
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

  return (
    <>
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
            </>
          }
        />
      ) : (
        <HeaderBar
          title={albumName}
          actions={
            <>
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
