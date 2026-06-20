"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Download, FolderPlus, Loader2, Trash2 } from "lucide-react";
import { downloadSelection } from "@/lib/download-client";
import { Button } from "@/components/ui/button";
import { useGridSelection } from "@/lib/use-grid-selection";
import { useGridView } from "@/lib/use-grid-view";
import { useGridColumns } from "@/lib/use-grid-columns";
import { GridViewMenu } from "@/components/grid-view-menu";
import { GridSizeMenu } from "@/components/grid-size-menu";
import { useGridSort } from "@/lib/use-grid-sort";
import { GridSortMenu } from "@/components/grid-sort-menu";
import { PhotoGrid, type PhotoGridHandle } from "@/components/photo-grid/photo-grid";
import { PhotoCollectionProvider } from "@/components/photo-grid/photo-collection";
import { Lightbox } from "@/components/photo-grid/lightbox";
import { photoHref } from "@/lib/photo-href";
import { SelectionToolbar } from "./selection-toolbar";
import { AddToAlbumDialog } from "@/components/photo-actions/add-to-album-dialog";
import { ColorLabelMenu } from "@/components/photo-actions/color-label-menu";
import type { ColorLabel } from "@lumio/shared";
import { HeaderBar } from "@/components/header-bar";
import { useConfirm } from "@/components/confirm-dialog";

export function LibraryView() {
  const sel = useGridSelection();
  const { mode, setMode } = useGridView();
  const { columns, setColumns } = useGridColumns();
  const { sort, setSort } = useGridSort();
  const [dialogOpen, setDialogOpen] = useState(false);
  const gridRef = useRef<PhotoGridHandle>(null);
  const { confirm, confirmDialog } = useConfirm();
  const [labelPending, setLabelPending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState(false);

  async function handleDelete() {
    const ids = sel.selected;
    if (ids.size === 0 || deleting) return;
    const label = `${ids.size} ${ids.size === 1 ? "photo" : "photos"}`;
    const ok = await confirm({
      title: `Move ${label} to Trash?`,
      description: "They'll be moved to Trash. You can restore them later.",
      confirmLabel: "Move to Trash",
      destructive: true,
    });
    if (!ok) return;
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
      sel.clear();
    } catch {
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
      // Optimistically repaint the client-fetched grid, keeping the selection
      // intact so the user can keep acting on the same photos.
      gridRef.current?.patchPhotos(ids, { colorLabel: label });
    } catch {
      toast.error("Failed to apply label.");
    } finally {
      setLabelPending(false);
    }
  }

  return (
    <>
      {confirmDialog}
      {sel.count > 0 ? (
        <SelectionToolbar
          title="Select photos"
          count={sel.count}
          onCancel={sel.clear}
          actions={
            <>
              <ColorLabelMenu
                disabled={sel.count === 0 || labelPending}
                onPick={(label) => void applyLabel(label)}
              />
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
          title="Library"
          actions={
            <>
              <GridViewMenu mode={mode} onModeChange={setMode} />
              <GridSizeMenu columns={columns} onColumnsChange={setColumns} />
              <GridSortMenu sort={sort} onSortChange={setSort} />
            </>
          }
        />
      )}

      <PhotoCollectionProvider
        key={sort}
        endpoint="/api/photos"
        params={new URLSearchParams({ sort })}
        urlForId={(id) => photoHref(id, undefined, sort)}
        baseUrl="/photos"
      >
        <PhotoGrid
          apiRef={gridRef}
          mode={mode}
          columns={columns}
          selectedIds={sel.selected}
          onSelectionChange={sel.setSelected}
        />
        <Lightbox />
      </PhotoCollectionProvider>

      <AddToAlbumDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        photoIds={[...sel.selected]}
        onAdded={() => {
          // Keep the selection and select mode so the user can keep acting on
          // the same photos after adding them to an album.
          setDialogOpen(false);
        }}
      />
    </>
  );
}
