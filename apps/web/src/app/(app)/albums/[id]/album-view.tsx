"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FolderMinus, FolderPlus, Images, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useGridSelection } from "@/lib/use-grid-selection";
import { useGridView } from "@/lib/use-grid-view";
import { useGridColumns } from "@/lib/use-grid-columns";
import { GridViewMenu } from "@/components/grid-view-menu";
import { GridSizeMenu } from "@/components/grid-size-menu";
import { useGridSort } from "@/lib/use-grid-sort";
import { GridSortMenu } from "@/components/grid-sort-menu";
import { PhotoGrid } from "@/components/photo-grid/photo-grid";
import { PhotoCollectionProvider } from "@/components/photo-grid/photo-collection";
import { Lightbox } from "@/components/photo-grid/lightbox";
import { photoHref } from "@/lib/photo-href";
import { SelectionToolbar } from "@/app/(app)/photos/selection-toolbar";
import { AddToAlbumDialog } from "@/components/photo-actions/add-to-album-dialog";
import { HeaderBar } from "@/components/header-bar";
import { useConfirm } from "@/components/confirm-dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { downloadSelection } from "@/lib/download-client";

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
  const { columns, setColumns } = useGridColumns();
  const { sort, setSort } = useGridSort();
  const { confirm, confirmDialog } = useConfirm();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState(false);

  function handleCancel() {
    setRemoveError(null);
    sel.clear();
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
        sel.clear();
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
      sel.clear();
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

  async function handleDownload() {
    const ids = [...sel.selected];
    if (ids.length === 0 || downloading) return;
    setDownloading(true);
    try {
      await downloadSelection(ids);
      // Clear the selection on success while staying in select mode, mirroring
      // the color-label flow — the batch is done, but you may pick another set.
      sel.clear();
    } catch {
      toast.error("Failed to download photos.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      {confirmDialog}
      {sel.count > 0 ? (
        <SelectionToolbar
          title={albumName}
          count={sel.count}
          onCancel={handleCancel}
          actions={
            <>
              <Button
                variant="outline"
                size="icon-sm"
                disabled={sel.count === 0}
                onClick={() => setDialogOpen(true)}
                aria-label="Add to album"
                title="Add to album"
              >
                <FolderPlus aria-hidden />
              </Button>
              {!isSmart && (
                <Button
                  variant="destructive"
                  size="icon-sm"
                  disabled={sel.count === 0 || removing}
                  onClick={() => void handleRemove()}
                  aria-label="Remove from album"
                  title="Remove from album"
                >
                  {removing ? <Loader2 className="animate-spin" aria-hidden /> : <FolderMinus aria-hidden />}
                </Button>
              )}
              <Button
                variant="outline"
                size="icon-sm"
                disabled={sel.count === 0 || downloading}
                onClick={() => void handleDownload()}
                aria-label="Download"
                title="Download"
              >
                {downloading ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
              </Button>
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
            </>
          }
        />
      ) : (
        <HeaderBar
          title={albumName}
          actions={
            <>
              <GridViewMenu mode={mode} onModeChange={setMode} />
              <GridSizeMenu columns={columns} onColumnsChange={setColumns} />
              <GridSortMenu sort={sort} onSortChange={setSort} />
              <Button asChild variant="outline" size="icon-sm" aria-label="Download album" title="Download album">
                <a href={`/api/albums/${albumId}/download`}>
                  <Download aria-hidden />
                </a>
              </Button>
            </>
          }
        />
      )}

      {removeError && (
        <p className="mb-4 text-sm text-destructive">{removeError}</p>
      )}

      <PhotoCollectionProvider
        key={`${reloadKey}:${sort}`}
        endpoint={`/api/albums/${albumId}/photos`}
        params={new URLSearchParams({ sort })}
        urlForId={(id) => photoHref(id, albumId, sort)}
        baseUrl={`/albums/${albumId}`}
      >
        <PhotoGrid
          mode={mode}
          columns={columns}
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
        <Lightbox />
      </PhotoCollectionProvider>

      <AddToAlbumDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        photoIds={[...sel.selected]}
        excludeAlbumId={albumId}
        onAdded={() => {
          // Keep the selection and select mode so the user can keep acting on
          // the same photos after adding them to an album.
          setDialogOpen(false);
        }}
      />
    </>
  );
}
